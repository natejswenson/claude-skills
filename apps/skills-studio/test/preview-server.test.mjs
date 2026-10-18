import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createPreviewServer } from '../preview/server.mjs';

const token = 'synthetic-preview-master-secret-32-characters';
const host = 'studio-preview.dev.internal';
const proof = role => createHmac('sha256', token).update(`skills-studio-${role}`).digest('hex');

async function setup(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-preview-test-'));
  await writeFile(join(directory, 'index.html'), '<h1>Studio</h1>');
  const server = createPreviewServer({ token, expectedHost: host, distDir: directory, revision: 'source-hash', ...config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    server.closeBridge();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  function open(path, { method = 'GET', headers = {}, data } = {}) {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } });
    const response = once(req, 'response').then(([res]) => res);
    req.end(data);
    return { req, response };
  }
  async function fetch(path, options) {
    const { response } = open(path, options);
    const res = await response;
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) };
  }
  async function login() {
    const result = await fetch('/_session', { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json' }, data: JSON.stringify({ token: proof('browser') }) });
    assert.equal(result.status, 200);
    return result.headers['set-cookie'][0].split(';')[0];
  }
  async function connect(handler) {
    const client = new WebSocket(`ws://127.0.0.1:${port}/_bridge`, { headers: { host, Authorization: `Bearer ${proof('agent')}` } });
    clients.push(client);
    if (handler) client.on('message', data => handler(JSON.parse(data.toString()), client));
    await once(client, 'open');
    return client;
  }
  return { directory, server, port, clients, fetch, open, login, connect };
}
function respond(ws, id, status, headers, data) {
  ws.send(JSON.stringify({ type: 'headers', id, status, headers }));
  if (data) ws.send(JSON.stringify({ type: 'data', id, data: Buffer.from(data).toString('base64') }));
  ws.send(JSON.stringify({ type: 'end', id }));
}
async function rejectedSocket(port, headers) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/_bridge`, { headers: { host, ...headers } });
  client.on('error', () => {});
  return new Promise((resolve, reject) => {
    client.once('unexpected-response', (_request, response) => { response.resume(); client.terminate(); resolve(response.statusCode); });
    client.once('open', () => { client.terminate(); reject(new Error('Unexpected authorized bridge.')); });
  });
}

test('preview gateway fails closed when secret or hostname configuration is missing', () => {
  assert.throws(() => createPreviewServer({ token: 'short', expectedHost: host }), /32/);
  assert.throws(() => createPreviewServer({ token }), /PREVIEW_HOST/);
});

test('public health/revision expose only metadata; browser session requires the browser proof and exact origin', async t => {
  const app = await setup(t);
  assert.deepEqual(JSON.parse((await app.fetch('/health', { headers: { host: '10.0.0.2:8080' } })).body), { ok: true });
  assert.deepEqual(JSON.parse((await app.fetch('/_revision')).body), { sha256: 'source-hash', preview: process.env.TK_PREVIEW_ID || null });
  assert.equal((await app.fetch('/')).status, 200);
  assert.match((await app.fetch('/')).body.toString(), /Preview access code/);
  assert.equal((await app.fetch('/api/bootstrap')).status, 401);
  for (const badToken of [token, proof('agent'), 'incorrect']) {
    assert.equal((await app.fetch('/_session', { method: 'POST', data: JSON.stringify({ token: badToken }) })).status, 401);
  }
  const loginBody = JSON.stringify({ token: proof('browser') });
  for (const headers of [{ origin: 'https://evil.example' }, { origin: `http://${host}` }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.fetch('/_session', { method: 'POST', headers, data: loginBody })).status, 403);
  }
  const result = await app.fetch('/_session', { method: 'POST', headers: { origin: `https://${host}` }, data: loginBody });
  assert.match(result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict; Path=\//);
  const cookie = result.headers['set-cookie'][0].split(';')[0];
  assert.equal((await app.fetch('/', { headers: { cookie } })).body.toString(), '<h1>Studio</h1>');
  assert.equal((await app.fetch('/api/bootstrap', { headers: { cookie } })).status, 503);
  assert.equal((await app.fetch('/', { headers: { cookie, origin: 'https://evil.example' } })).status, 403);
});

test('agent bridge requires a distinct HMAC proof and cannot replace the connected worker', async t => {
  const app = await setup(t);
  assert.equal(await rejectedSocket(app.port, { Authorization: `Bearer ${proof('browser')}` }), 403);
  assert.equal(await rejectedSocket(app.port, { Authorization: `Bearer ${token}` }), 403);
  assert.equal(await rejectedSocket(app.port, { Authorization: `Bearer ${proof('agent')}`, origin: 'https://evil.example' }), 403);
  await app.connect();
  assert.equal(await rejectedSocket(app.port, { Authorization: `Bearer ${proof('agent')}` }), 403);
});

test('uploads and downloads stream through the bridge without exposing browser or agent authentication', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  const payload = Buffer.from('attachment \u0000 bytes é');
  let forwarded;
  await app.connect((message, ws) => {
    if (message.type !== 'request') return;
    forwarded = message;
    respond(ws, message.id, 200, { 'content-type': 'application/octet-stream', 'content-length': String(payload.length), 'content-disposition': 'attachment; filename="notes.txt"', 'set-cookie': 'secret=upstream', authorization: 'Bearer upstream', connection: 'keep-alive' }, payload);
  });
  const result = await app.fetch('/api/runs/example/messages?attachment=1', { method: 'POST', headers: { cookie, authorization: 'Bearer browser-secret', origin: `https://${host}`, 'content-type': 'application/octet-stream', 'x-forwarded-for': 'untrusted', connection: 'keep-alive, x-private', 'x-private': 'private' }, data: payload });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, payload);
  assert.equal(forwarded.path, '/api/runs/example/messages?attachment=1');
  assert.deepEqual(Buffer.from(forwarded.body, 'base64'), payload);
  for (const name of ['host', 'origin', 'authorization', 'cookie', 'x-forwarded-for', 'connection', 'x-private']) assert.equal(forwarded.headers[name], undefined);
  assert.equal(forwarded.headers['content-type'], 'application/octet-stream');
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.headers.authorization, undefined);
  assert.match(result.headers['content-disposition'], /notes.txt/);
});

test('SSE sends data before upstream completion and cancels when the browser disconnects', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  let cancel;
  const cancelled = new Promise(resolve => { cancel = resolve; });
  let requestId;
  await app.connect((message, ws) => {
    if (message.type === 'request') {
      requestId = message.id;
      ws.send(JSON.stringify({ type: 'headers', id: message.id, status: 200, headers: { 'content-type': 'text/event-stream' } }));
      ws.send(JSON.stringify({ type: 'data', id: message.id, data: Buffer.from('data: {"type":"change"}\n\n').toString('base64') }));
    } else if (message.type === 'cancel') cancel(message.id);
  });
  const { response } = app.open('/api/events', { headers: { cookie } });
  const res = await response;
  assert.equal(res.headers['content-type'], 'text/event-stream');
  const [chunk] = await once(res, 'data');
  assert.match(chunk.toString(), /"change"/);
  res.destroy();
  assert.equal(await cancelled, requestId);
});

test('worker disconnect fails outstanding requests and a reconnect can serve new ones', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  const worker = await app.connect((_message, ws) => ws.close());
  const closed = once(worker, 'close');
  assert.equal((await app.fetch('/api/bootstrap', { headers: { cookie } })).status, 503);
  await closed;
  await app.connect((message, ws) => { if (message.type === 'request') respond(ws, message.id, 200, { 'content-type': 'application/json' }, '{"connected":true}'); });
  assert.equal((await app.fetch('/api/bootstrap', { headers: { cookie } })).body.toString(), '{"connected":true}');
});

test('missing response headers time out and cancel upstream work', async t => {
  const app = await setup(t, { requestTimeoutMs: 20 });
  const cookie = await app.login();
  let cancel;
  const cancelled = new Promise(resolve => { cancel = resolve; });
  await app.connect(message => { if (message.type === 'cancel') cancel(); });
  assert.equal((await app.fetch('/api/bootstrap', { headers: { cookie } })).status, 504);
  await cancelled;
});

test('static serving rejects symlink escapes and encoded directory traversal', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  const outside = join(app.directory, '../outside-' + Date.now());
  await writeFile(outside, 'private');
  t.after(() => rm(outside, { force: true }));
  await symlink(outside, join(app.directory, 'escape'));
  for (const path of ['/escape', '/../outside-missing', '/..%2f' + outside.split('/').at(-1)]) {
    const result = await app.fetch(path, { headers: { cookie } });
    assert.ok([403, 404].includes(result.status));
    assert.notEqual(result.body.toString(), 'private');
  }
});

test('oversized attachment requests are rejected before forwarding to the host', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  let forwarded = false;
  await app.connect(() => { forwarded = true; });
  const result = await app.fetch('/api/runs', { method: 'POST', headers: { cookie }, data: Buffer.alloc(32 * 1024 * 1024 + 1) });
  assert.equal(result.status, 413);
  assert.equal(forwarded, false);
});

test('malformed bridge responses fail outstanding browser requests safely', async t => {
  const app = await setup(t);
  const cookie = await app.login();
  await app.connect((_message, ws) => ws.send('{malformed json'));
  const result = await app.fetch('/api/bootstrap', { headers: { cookie } });
  assert.equal(result.status, 503);
  assert.match(result.body.toString(), /worker disconnected/);
});


test('login page uses fresh CSP nonces and allows only same-origin fetch connections', async t => {
  const app = await setup(t);
  const first = await app.fetch('/');
  const second = await app.fetch('/');
  const nonce = first.body.toString().match(/<script nonce="([^"]+)"/)[1];
  assert.ok(first.headers['content-security-policy'].split(';').map(value => value.trim()).includes(`script-src 'nonce-${nonce}'`));
  assert.match(first.headers['content-security-policy'], /connect-src 'self'/);
  assert.doesNotMatch(first.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
  assert.notEqual(second.body.toString().match(/<script nonce="([^"]+)"/)[1], nonce);
  assert.match(first.body.toString(), /role="alert" hidden/);
});

test('login fetch preserves credentials, prevents double submission, reloads on success and shows failures', async () => {
  const html = await readFile(new URL('../preview/login.html', import.meta.url), 'utf8');
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  for (const accepted of [true, false]) {
    let submit;
    let resolveFetch;
    let sent;
    let reloaded = false;
    const button = { disabled: false, textContent: 'Open Skills Studio' };
    const field = { value: ' synthetic-browser-proof ' };
    const error = { hidden: true, textContent: '' };
    const form = { querySelector: () => button, addEventListener: (_name, listener) => { submit = listener; } };
    runInNewContext(script, {
      document: { getElementById: id => ({ 'login-form': form, token: field, 'login-error': error })[id] },
      location: { reload: () => { reloaded = true; } },
      fetch: (url, options) => { sent = { url, options }; return new Promise(resolve => { resolveFetch = resolve; }); },
    });
    const pending = submit({ preventDefault() {} });
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Connecting…');
    await submit({ preventDefault() {} });
    assert.equal(sent.url, '/_session');
    assert.equal(sent.options.credentials, 'same-origin');
    assert.equal(sent.options.method, 'POST');
    assert.deepEqual(JSON.parse(sent.options.body), { token: 'synthetic-browser-proof' });
    resolveFetch({ ok: accepted, status: accepted ? 200 : 401 });
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(reloaded, accepted);
    if (accepted) assert.equal(field.value, '');
    else {
      assert.equal(error.hidden, false);
      assert.match(error.textContent, /not accepted/);
      assert.doesNotMatch(error.textContent, /synthetic-browser-proof/);
    }
  }
});
