import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient } from './codex.mjs';
import { Store } from './store.mjs';
import { readCatalog } from './catalog.mjs';
import { RunManager } from './runs.mjs';
import { validateLocalRequest, resolveArtifact } from './security.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const dataDir = resolve(process.env.STUDIO_DATA_DIR || join(appRoot, '.studio-data'));
const port = Number(process.env.PORT || 4317);
await mkdir(join(dataDir, 'workspace'), { recursive: true, mode: 0o700 });
let preferences = {};
try { preferences = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')); } catch {}
const store = new Store(join(dataDir, 'studio.sqlite'));
const client = new CodexClient({ cwd: repoRoot });
const manager = new RunManager({ client, store, repoRoot, dataDir, workspace: process.env.STUDIO_WORKSPACE || preferences.workspace || join(dataDir, 'workspace'), catalog: await readCatalog(repoRoot) });
const listeners = new Set();
let updateTimer;
manager.on('change', () => {
  if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = null; for (const response of listeners) response.write('data: {"type":"change"}\n\n'); }, 100);
});
const mime = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain' };
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) {
  let data = '';
  for await (const chunk of request) { data += chunk; if (Buffer.byteLength(data) > 100000) throw Object.assign(new Error('Request is too large.'), { status: 413 }); }
  try { return JSON.parse(data || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
}
const server = createServer(async (request, response) => {
  try {
    validateLocalRequest(request, [`127.0.0.1:${port}`, `localhost:${port}`, 'localhost:5173', '127.0.0.1:5173']);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write('data: {"type":"change"}\n\n');
      listeners.add(response);
      const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
      request.on('close', () => { clearInterval(heartbeat); listeners.delete(response); });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') return json(response, 200, manager.bootstrap());
    if (request.method === 'POST' && url.pathname === '/api/reconnect') { await body(request); return json(response, 200, await manager.reconnect()); }
    if (request.method === 'POST' && url.pathname === '/api/workspace') {
      const result = await manager.selectWorkspace((await body(request)).path);
      await writeFile(join(dataDir, 'settings.json'), JSON.stringify(result), { mode: 0o600 });
      return json(response, 200, result);
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') return json(response, 201, await manager.create(await body(request)));
    if (parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
      const run = manager.get(parts[2]);
      if (request.method === 'GET' && parts.length === 3) return json(response, 200, run);
      if (request.method === 'POST' && parts.length === 4) {
        const input = await body(request);
        if (parts[3] === 'messages') return json(response, 200, await manager.followUp(run.id, input));
        if (parts[3] === 'interrupt') return json(response, 200, await manager.interrupt(run.id));
        if (parts[3] === 'respond') return json(response, 200, manager.respond(run.id, input));
      }
      if (request.method === 'GET' && parts[3] === 'artifacts' && parts.length === 5) {
        const artifact = run.artifacts.find(artifact => artifact.id === parts[4]);
        if (!artifact) return json(response, 404, { error: 'Artifact not found.' });
        const { path, size } = await resolveArtifact(join(dataDir, 'artifacts', run.id), artifact.file);
        response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
        response.writeHead(200, { 'Content-Type': mime[extname(path).toLowerCase()] || 'text/plain', 'Content-Length': size, 'Cache-Control': 'no-store', 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${artifact.name.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_')}"` });
        createReadStream(path).on('error', () => response.destroy()).pipe(response);
        return;
      }
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Endpoint not found.' });
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
    let path;
    try { path = (await resolveArtifact(join(appRoot, 'dist'), decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html')).path; }
    catch { path = join(appRoot, 'dist/index.html'); }
    const content = await readFile(path).catch(() => null);
    if (!content) return json(response, 503, { error: 'Build the frontend with npm run build, or use npm run dev on port 5173.' });
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(content);
  } catch (error) { if (!response.headersSent) json(response, error.status || 500, { error: error.message }); else response.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Skills Studio: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(`Skills Studio could not listen: ${error.message}`); client.close(); store.close(); process.exitCode = 1; });
manager.initialize();
function close() { client.close(); for (const response of listeners) response.end(); server.close(); store.close(); }
process.once('SIGINT', () => { close(); process.exit(0); });
process.once('SIGTERM', () => { close(); process.exit(0); });
