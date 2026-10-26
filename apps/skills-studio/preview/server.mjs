import { createServer, validateHeaderName, validateHeaderValue } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 32 * 1024 * 1024;
const SESSION_LIFETIME = 24 * 60 * 60 * 1000;
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'authorization', 'cookie', 'set-cookie', 'origin', 'host', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function equal(value, expected) {
  if (typeof value !== 'string') return false;
  const actual = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
function headersWithoutSecrets(headers = {}) {
  const connectionTokens = String(headers.connection || '').toLowerCase().split(',').map(value => value.trim());
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_HEADERS.has(lower) || connectionTokens.includes(lower) || lower.startsWith('sec-')) continue;
    try { validateHeaderName(lower); validateHeaderValue(lower, value); } catch { continue; }
    result[lower] = value;
  }
  return result;
}
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function readBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else chunks.length = 0;
    });
    request.once('end', () => {
      if (size > limit) reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
      else resolveBody(Buffer.concat(chunks));
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new Error('Request aborted.')));
  });
}

// Only this gateway lives in Kubernetes. Subscription credentials, files and Codex
// stay in the host worker; its outbound tunnel needs no pod egress or host mounts.
export function createPreviewServer({ token, expectedHost, distDir = join(here, '../dist'), revision, requestTimeoutMs = 30000 } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('PREVIEW_API_TOKEN must contain at least 32 characters.');
  if (typeof expectedHost !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(expectedHost)) throw new Error('A valid PREVIEW_HOST is required.');
  const previewId = expectedHost.match(/^skills-studio-(p-[a-f0-9]{12})\.dev\.internal$/)?.[1] || 'PREVIEW_ID';
  const launcherCommand = `npm run preview:connect -- --preview ${previewId}`;
  const disconnectedHelp = `Preview launcher disconnected. In apps/skills-studio on this Mac, run ${launcherCommand}, keep it running, then refresh this page. Check saved history before retrying an interrupted request.`;
  const proof = role => createHmac('sha256', token).update(`skills-studio-${role}`).digest('hex');
  const agentProof = proof('agent');
  const browserProof = proof('browser');
  const sessions = new Map();
  const pending = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: Math.ceil(BODY_LIMIT / 3) * 4 + 65536 });
  let bridge;
  const sourceRevision = revision === undefined ? readFile(fileURLToPath(import.meta.url)).then(data => createHash('sha256').update(data).digest('hex')) : Promise.resolve(revision);
  const trusted = request => request.headers.host === expectedHost && (request.headers.origin === undefined || request.headers.origin === `https://${expectedHost}`) && request.headers['sec-fetch-site'] !== 'cross-site';
  function authenticated(request) {
    const cookies = String(request.headers.cookie || '').split(';').map(value => value.trim());
    const session = cookies.find(value => value.startsWith('studio_session='))?.slice('studio_session='.length);
    if (!session || !sessions.has(session)) return false;
    if (sessions.get(session) < Date.now()) { sessions.delete(session); return false; }
    return session;
  }
  function sendCancel(id) { if (bridge?.readyState === WebSocket.OPEN) bridge.send(JSON.stringify({ type: 'cancel', id })); }
  function finish(id) {
    const entry = pending.get(id);
    if (entry) { clearTimeout(entry.timer); pending.delete(id); }
    return entry;
  }
  function failAll() {
    for (const id of [...pending.keys()]) {
      const entry = finish(id);
      if (!entry.response.headersSent) json(entry.response, 503, { error: disconnectedHelp });
      else entry.response.destroy();
    }
  }
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(request.url, `https://${expectedHost}`);
      if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { ok: true });
      if (!trusted(request)) return json(response, 403, { error: 'Unrecognized preview origin or host.' });
      if (url.pathname === '/_revision' && request.method === 'GET') {
        return json(response, 200, { sha256: await sourceRevision, preview: process.env.TK_PREVIEW_ID || null });
      }
      if (url.pathname === '/_session' && request.method === 'POST') {
        let supplied;
        const data = (await readBody(request, 2048)).toString('utf8');
        const isForm = String(request.headers['content-type']).startsWith('application/x-www-form-urlencoded');
        try { supplied = isForm ? new URLSearchParams(data).get('token') : JSON.parse(data).token; }
        catch { return json(response, 400, { error: 'Invalid login request.' }); }
        if (!equal(supplied, browserProof)) return json(response, 401, { error: 'Invalid preview access token.' });
        for (const [session, expires] of sessions) if (expires < Date.now()) sessions.delete(session);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const session = randomBytes(32).toString('hex');
        sessions.set(session, Date.now() + SESSION_LIFETIME);
        response.setHeader('Set-Cookie', `studio_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`);
        if (isForm) { response.writeHead(303, { Location: '/' }); response.end(); return; }
        return json(response, 200, { ok: true });
      }
      const session = authenticated(request);
      if (url.pathname === '/api/session' && request.method === 'DELETE') {
        if (session) {
          sessions.delete(session);
          for (const [id, entry] of pending) {
            if (entry.session !== session) continue;
            finish(id);
            sendCancel(id);
            if (!entry.response.headersSent) json(entry.response, 401, { error: 'Preview sign-in required.' });
            else entry.response.destroy();
          }
        }
        response.setHeader('Set-Cookie', 'studio_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
        return json(response, 200, { ok: true });
      }
      if (!session) {
        if (url.pathname.startsWith('/api/') || request.method !== 'GET') return json(response, 401, { error: 'Preview sign-in required.' });
        const [html, tokens] = await Promise.all([readFile(join(here, 'login.html'), 'utf8'), readFile(join(here, '../src/tokens.css'), 'utf8')]);
        const nonce = randomBytes(18).toString('base64');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
        response.end(html.replace('/* PREVIEW_BRAND_TOKENS */', tokens).replace('PREVIEW_SCRIPT_NONCE', nonce).replace('PREVIEW_COPY_COMMAND', `${launcherCommand} --copy-access`).replace('PREVIEW_HTTPS_URL', `https://${expectedHost}`));
        return;
      }
      if (url.pathname === '/api/session') {
        return request.method === 'GET' ? json(response, 200, { signOut: true }) : json(response, 405, { error: 'Method not allowed.' });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!bridge || bridge.readyState !== WebSocket.OPEN) return json(response, 503, { error: disconnectedHelp });
        if (pending.size >= 64) return json(response, 503, { error: 'Preview is busy. Try again shortly.' });
        const data = await readBody(request, BODY_LIMIT);
        if (authenticated(request) !== session) return json(response, 401, { error: 'Preview sign-in required.' });
        if (!bridge || bridge.readyState !== WebSocket.OPEN) return json(response, 503, { error: disconnectedHelp });
        const id = randomUUID();
        const timer = setTimeout(() => {
          const entry = finish(id);
          if (!entry) return;
          sendCancel(id);
          json(response, 504, { error: 'Preview worker response timed out.' });
        }, requestTimeoutMs);
        pending.set(id, { response, timer, session });
        response.on('close', () => { if (finish(id)) sendCancel(id); });
        bridge.send(JSON.stringify({ type: 'request', id, method: request.method, path: url.pathname + url.search, headers: headersWithoutSecrets(request.headers), body: data.toString('base64') }));
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' });
      let path;
      try {
        const root = await realpath(distDir);
        const decoded = decodeURIComponent(url.pathname);
        const candidate = await realpath(resolve(root, decoded.replace(/^\/+/, '') || 'index.html'));
        const fromRoot = relative(root, candidate);
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return json(response, 403, { error: 'Invalid asset path.' });
        const info = await stat(candidate);
        if (!info.isFile()) return json(response, 404, { error: 'Asset not found.' });
        if (info.size > 10 * 1024 * 1024) return json(response, 413, { error: 'Asset too large.' });
        path = candidate;
      } catch (error) {
        if (error instanceof URIError) return json(response, 400, { error: 'Invalid asset path.' });
        return json(response, 404, { error: 'Asset not found.' });
      }
      response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Security-Policy': "frame-ancestors 'none'" });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status === 413 ? error.message : 'Preview request failed.' });
      else response.destroy();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/_bridge' || !trusted(request) || !equal(request.headers.authorization, `Bearer ${agentProof}`) || bridge) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, connection => {
      bridge = connection;
      connection.on('error', () => {});
      connection.on('close', () => { if (bridge === connection) { bridge = undefined; failAll(); } });
      connection.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          const entry = pending.get(message.id);
          if (!entry) return;
          const { response } = entry;
          if (message.type === 'headers') {
            if (response.headersSent || !Number.isInteger(message.status) || message.status < 200 || message.status > 599) throw new Error('Invalid upstream response.');
            clearTimeout(entry.timer);
            response.writeHead(message.status, headersWithoutSecrets(message.headers));
            response.flushHeaders();
          } else if (message.type === 'data') {
            if (!response.headersSent || typeof message.data !== 'string') throw new Error('Invalid upstream data.');
            response.write(Buffer.from(message.data, 'base64'));
            if (response.writableLength > 1024 * 1024) { finish(message.id); sendCancel(message.id); response.destroy(); }
          } else if (message.type === 'end') {
            if (!response.headersSent) throw new Error('Missing upstream headers.');
            finish(message.id);
            response.end();
          } else if (message.type === 'error') {
            finish(message.id);
            if (!response.headersSent) json(response, 502, { error: 'Host preview request failed.' });
            else response.destroy();
          } else throw new Error('Unknown upstream message.');
        } catch { connection.close(1008, 'Invalid bridge response'); failAll(); }
      });
    });
  });
  server.on('close', () => { bridge?.terminate(); wss.close(); failAll(); sessions.clear(); });
  // Explicit helper lets tests and the local launcher close upgraded connections.
  server.closeBridge = () => bridge?.terminate();
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const expectedHost = process.env.PREVIEW_HOST || (process.env.TK_PREVIEW_ID ? `skills-studio-${process.env.TK_PREVIEW_ID}.dev.internal` : undefined);
  const server = createPreviewServer({ token: process.env.PREVIEW_API_TOKEN, expectedHost, distDir: process.env.DIST_DIR || join(here, '../dist') });
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Skills Studio preview gateway is ready.'));
  function stop() { server.closeBridge(); server.close(() => process.exit(0)); }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
