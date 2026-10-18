import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { connectAgent } from '../preview/agent.mjs';

const token = 'local-test-token-with-at-least-thirty-two-characters';
const agentToken = createHmac('sha256', token).update('skills-studio-agent').digest('hex');
async function fixture(t, handler) {
  const backend = createServer(handler);
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const gateway = createServer();
  const wsServer = new WebSocketServer({ server: gateway });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const connected = once(wsServer, 'connection');
  const agent = connectAgent({ bridgeUrl: `ws://127.0.0.1:${gateway.address().port}/_bridge`, expectedHost: 'studio-preview.localhost', agentToken, backendPort: backend.address().port });
  const [socket, request] = await connected;
  await agent.ready;
  t.after(async () => {
    agent.close();
    for (const client of wsServer.clients) client.terminate();
    await new Promise(resolve => wsServer.close(resolve));
    backend.closeAllConnections();
    await Promise.all([new Promise(resolve => backend.close(resolve)), new Promise(resolve => gateway.close(resolve))]);
  });
  const queue = [];
  let notify;
  socket.on('message', raw => { queue.push(JSON.parse(raw)); notify?.(); });
  const next = async () => {
    if (!queue.length) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for worker response')), 2000);
      notify = () => { clearTimeout(timer); notify = null; resolve(); };
    });
    return queue.shift();
  };
  const send = payload => socket.send(JSON.stringify(payload));
  const requestApi = (id, path = '/api/bootstrap', extra = {}) => send({ type: 'request', id, method: 'GET', path, headers: {}, body: '', ...extra });
  return { socket, request, requestApi, next, send, backend, wsServer, agent };
}

test('authenticates the bridge and forwards bodies with only safe headers to the fixed local backend', async t => {
  let captured;
  const { request, requestApi, next, backend } = await fixture(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=session', 'X-Private-Token': token, Authorization: token });
    res.end('{"ok":true}');
  });
  assert.equal(request.headers.host, 'studio-preview.localhost');
  assert.equal(request.headers.authorization, `Bearer ${createHmac('sha256', token).update('skills-studio-agent').digest('hex')}`);
  const body = Buffer.from('upload bytes\u0000\ufffd');
  requestApi('upload-1', '/api/runs?mode=test', { method: 'POST', body: body.toString('base64'), headers: { 'content-type': 'application/json', cookie: 'private', authorization: 'Bearer private', origin: 'https://evil.test', host: 'evil.test', 'sec-fetch-site': 'cross-site', 'proxy-authorization': 'private', 'x-private-token': 'private', connection: 'keep-alive' } });
  const headers = await next();
  assert.equal(headers.status, 201);
  assert.equal(headers.headers['content-type'], 'application/json');
  assert.equal(JSON.stringify(headers).includes(token), false);
  assert.equal(headers.headers['set-cookie'], undefined);
  let response = '';
  for (let message = await next(); message.type !== 'end'; message = await next()) response += Buffer.from(message.data, 'base64').toString();
  assert.equal(response, '{"ok":true}');
  assert.equal(captured.headers.host, `127.0.0.1:${backend.address().port}`);
  for (const name of ['authorization', 'cookie', 'origin', 'sec-fetch-site', 'proxy-authorization', 'x-private-token']) assert.equal(captured.headers[name], undefined);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, '/api/runs?mode=test');
  assert.deepEqual(captured.body, body);
});

test('streams an SSE chunk immediately and cancellation closes the upstream request', async t => {
  let upstreamClosed;
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const { requestApi, next, send } = await fixture(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: first\n\n');
    res.on('close', upstreamClosed);
  });
  requestApi('events', '/api/events');
  assert.equal((await next()).type, 'headers');
  const chunk = await next();
  assert.equal(chunk.type, 'data');
  assert.equal(Buffer.from(chunk.data, 'base64').toString(), 'data: first\n\n');
  send({ type: 'cancel', id: 'events' });
  await closed;
});

test('rejects untrusted paths, malformed bodies and header values without contacting the backend', async t => {
  let calls = 0;
  const { requestApi, next } = await fixture(t, (_, res) => { calls++; res.end('unexpected'); });
  const invalid = [
    { path: 'http://evil.test/api/bootstrap' }, { path: '//evil.test/api/bootstrap' },
    { path: '/other' }, { path: '/api/../private' }, { path: '/api/%2e%2e/private' },
    { path: '/api/runs\\private' }, { path: '/api/runs\nX-Secret: bad' },
    { body: 'not base64' }, { body: 'Zh==' }, { method: 'CONNECT' },
    { headers: { accept: 'text/plain\r\nX-Secret: bad' } },
  ];
  for (const [index, extra] of invalid.entries()) {
    requestApi(`bad-${index}`, '/api/bootstrap', extra);
    const message = await next();
    assert.equal(message.type, 'error', JSON.stringify(extra));
    assert.equal(message.id, `bad-${index}`);
    assert.equal(message.message, undefined);
  }
  assert.equal(calls, 0);
});

test('invalid protocol IDs fail closed', async t => {
  let calls = 0;
  const { socket, requestApi } = await fixture(t, (_, res) => { calls++; res.end(); });
  const closed = once(socket, 'close');
  requestApi('../unsafe');
  assert.equal((await closed)[0], 1008);
  assert.equal(calls, 0);
});

test('disconnect aborts active upstream streams', async t => {
  let upstreamClosed;
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const { socket, requestApi, next, agent } = await fixture(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': connected\n\n');
    res.on('close', upstreamClosed);
  });
  requestApi('events', '/api/events');
  await next();
  socket.close();
  await closed;
  agent.close();
});

test('bridge configuration accepts only exact-host WSS or loopback WS and a valid fixed backend port', () => {
  for (const bridgeUrl of ['ws://external.test/_bridge', 'wss://127.0.0.1/_bridge', 'ws://user:pass@127.0.0.1/_bridge', 'ws://127.0.0.1/other', 'ws://127.0.0.1/_bridge?token=secret']) {
    assert.throws(() => connectAgent({ bridgeUrl, agentToken, backendPort: 4317 }));
  }
  assert.throws(() => connectAgent({ bridgeUrl: 'wss://preview.localhost/_bridge', expectedHost: 'other.localhost', agentToken, backendPort: 4317 }));
  assert.throws(() => connectAgent({ bridgeUrl: 'wss://preview.localhost/_bridge', expectedHost: 'preview.localhost\r\nInjected: true', agentToken, backendPort: 4317 }));
  for (const backendPort of [0, 65536, NaN, '4317', 1.5]) assert.throws(() => connectAgent({ bridgeUrl: 'ws://127.0.0.1/_bridge', agentToken, backendPort }));
});

test('rejects a request body above 32 MiB before contacting the backend', async t => {
  let calls = 0;
  const { requestApi, next } = await fixture(t, (_, res) => { calls++; res.end(); });
  requestApi('oversized', '/api/runs', { method: 'POST', body: Buffer.alloc(32 * 1024 * 1024 + 1).toString('base64') });
  assert.deepEqual(await next(), { type: 'error', id: 'oversized' });
  assert.equal(calls, 0);
});

test('reconnects to the same bridge after disconnect and forwards a fresh request', async t => {
  const { socket, wsServer } = await fixture(t, (_, res) => res.end('reconnected'));
  const replacement = once(wsServer, 'connection');
  socket.close();
  const [connected] = await replacement;
  const messages = [];
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  connected.on('message', raw => {
    const message = JSON.parse(raw);
    messages.push(message);
    if (message.type === 'end') finish();
  });
  connected.send(JSON.stringify({ type: 'request', id: 'fresh', method: 'GET', path: '/api/bootstrap', headers: {}, body: '' }));
  await finished;
  assert.deepEqual(messages.map(message => message.type), ['headers', 'data', 'end']);
  assert.equal(Buffer.from(messages[1].data, 'base64').toString(), 'reconnected');
});
