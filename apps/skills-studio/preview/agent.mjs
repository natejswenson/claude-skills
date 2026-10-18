import { request as httpRequest } from 'node:http';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const maxBodyBytes = 32 * 1024 * 1024;
const maxPayload = Math.ceil(maxBodyBytes / 3) * 4 + 64 * 1024;
const requestHeaders = new Set(['accept', 'content-type', 'range', 'if-none-match', 'if-modified-since']);
const responseHeaders = new Set(['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control', 'x-content-type-options', 'content-security-policy', 'referrer-policy', 'x-accel-buffering']);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const controlCharacters = /[\x00-\x1f\x7f]/;

function configuration(bridgeUrl, agentToken, backendPort, expectedHost) {
  let url;
  try { url = new URL(bridgeUrl); } catch { throw new Error('Invalid preview bridge configuration.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const validHost = typeof expectedHost === 'string' && /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(expectedHost);
  const transport = (url.protocol === 'ws:' && local) || (url.protocol === 'wss:' && validHost && url.host === expectedHost);
  if (!transport || url.username || url.password || url.pathname !== '/_bridge' || url.search || url.hash ||
      (expectedHost !== undefined && !validHost) || !Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535 ||
      typeof agentToken !== 'string' || !/^[a-f0-9]{64}$/.test(agentToken)) {
    throw new Error('Invalid preview bridge configuration.');
  }
  return url;
}

function filteredHeaders(headers, allowed) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 64) throw new Error('Invalid headers.');
  const filtered = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || value.length > 8192 || controlCharacters.test(value)) throw new Error('Invalid headers.');
    const lower = name.toLowerCase();
    if (allowed.has(lower)) filtered[lower] = value;
  }
  return filtered;
}

function validatedRequest(message) {
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(message.method) ||
      typeof message.path !== 'string' || message.path.length > 8192 || !message.path.startsWith('/api/') ||
      message.path.includes('\\') || controlCharacters.test(message.path) || message.path.includes('#')) throw new Error('Invalid request.');
  const url = new URL(message.path, 'http://127.0.0.1');
  const decoded = decodeURIComponent(url.pathname);
  if (url.origin !== 'http://127.0.0.1' || !url.pathname.startsWith('/api/') || decoded.includes('\\') || controlCharacters.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Invalid request path.');
  const headers = filteredHeaders(message.headers, requestHeaders);
  const data = message.body;
  if (typeof data !== 'string' || data.length > Math.ceil(maxBodyBytes / 3) * 4 || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) throw new Error('Invalid request body.');
  const body = Buffer.from(data, 'base64');
  if (body.length > maxBodyBytes || body.toString('base64') !== data) throw new Error('Invalid request body.');
  return { headers, body };
}

/** The worker can reach only one owned local backend. It never reads agent credentials. */
export function connectAgent({ bridgeUrl, agentToken, backendPort, expectedHost, ca, onState = () => {} }) {
  const url = configuration(bridgeUrl, agentToken, backendPort, expectedHost);
  let socket;
  let stopped = false;
  let retryTimer;
  let retryDelay = 250;
  const inflight = new Map();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const abort = id => {
    const current = inflight.get(id);
    if (!current) return;
    inflight.delete(id);
    clearTimeout(current.timer);
    current.response?.destroy();
    current.request.destroy();
  };
  const send = (connection, message, callback) => {
    if (connection.readyState !== WebSocket.OPEN) { callback?.(new Error('Bridge unavailable.')); return; }
    connection.send(JSON.stringify(message), callback);
  };
  const connect = () => {
    if (stopped) return;
    const connection = new WebSocket(url, {
      headers: { Host: expectedHost || url.host, Authorization: `Bearer ${agentToken}` },
      ...(ca ? { ca } : {}), rejectUnauthorized: true, followRedirects: false,
      handshakeTimeout: 10000, maxPayload, perMessageDeflate: false,
    });
    socket = connection;
    connection.on('open', () => { retryDelay = 250; resolveReady(); onState('connected'); });
    connection.on('error', () => { /* Close handles retry; errors never print request details or credentials. */ });
    connection.on('close', () => {
      for (const id of inflight.keys()) abort(id);
      if (!stopped) {
        onState('disconnected');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      }
    });
    connection.on('message', (raw, isBinary) => {
      let message;
      try {
        if (isBinary) throw new Error('Invalid protocol.');
        message = JSON.parse(raw.toString());
        if (!message || !safeId(message.id) || !['request', 'cancel'].includes(message.type)) throw new Error('Invalid protocol.');
      } catch { connection.close(1008, 'Invalid bridge protocol.'); return; }
      const { id } = message;
      if (message.type === 'cancel') { abort(id); return; }
      if (inflight.has(id)) { connection.close(1008, 'Duplicate request identifier.'); return; }
      let headers, body;
      try {
        if (inflight.size >= 64) throw new Error('Too many requests.');
        ({ headers, body } = validatedRequest(message));
      } catch { send(connection, { type: 'error', id }); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: backendPort, method: message.method, path: message.path, headers: { ...headers, host: `127.0.0.1:${backendPort}`, 'content-length': body.length } });
      const current = { request: upstream, timer: setTimeout(() => { send(connection, { type: 'error', id }); abort(id); }, 30000) };
      inflight.set(id, current);
      upstream.on('error', () => {
        if (!inflight.has(id)) return;
        send(connection, { type: 'error', id });
        abort(id);
      });
      upstream.on('response', response => {
        clearTimeout(current.timer);
        current.response = response;
        let safeHeaders;
        try {
          safeHeaders = filteredHeaders(Object.fromEntries(Object.entries(response.headers).filter(([name]) => responseHeaders.has(name))), responseHeaders);
        } catch { send(connection, { type: 'error', id }); abort(id); return; }
        send(connection, { type: 'headers', id, status: response.statusCode, headers: safeHeaders });
        response.on('data', chunk => {
          response.pause();
          send(connection, { type: 'data', id, data: chunk.toString('base64') }, error => {
            if (error) abort(id); else response.resume();
          });
        });
        response.on('end', () => { if (inflight.delete(id)) send(connection, { type: 'end', id }); });
        response.on('error', () => { if (inflight.has(id)) { send(connection, { type: 'error', id }); abort(id); } });
      });
      upstream.end(body);
    });
  };
  connect();
  return {
    ready,
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      for (const id of inflight.keys()) abort(id);
      socket?.terminate();
    },
  };
}

async function privateToken(path) {
  if (!path) throw new Error('Missing preview token file.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096 || (info.mode & 0o077)) throw new Error('Preview token file must be private.');
    return (await handle.readFile('utf8')).trim();
  } finally { await handle.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const agentToken = await privateToken(process.env.PREVIEW_AGENT_TOKEN_FILE);
    let ca;
    if (process.env.PREVIEW_CA_FILE) {
      const handle = await open(process.env.PREVIEW_CA_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid preview certificate file.');
        ca = await handle.readFile();
      } finally { await handle.close(); }
    }
    const agent = connectAgent({ bridgeUrl: process.env.PREVIEW_BRIDGE_URL, expectedHost: process.env.PREVIEW_HOST, agentToken, backendPort: Number(process.env.PREVIEW_BACKEND_PORT), ca, onState: state => console.log(`Preview agent ${state}.`) });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { agent.close(); process.exitCode = 0; });
  } catch { console.error('Preview agent failed: check its local configuration and private token file.'); process.exitCode = 1; }
}
