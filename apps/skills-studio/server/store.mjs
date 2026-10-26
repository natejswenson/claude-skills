import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const active = "json_extract(data, '$.status') IN ('working','approval_needed','awaiting_input','collecting_output')";
const summary = "id, updatedAt, json_extract(data, '$.title') AS title, json_extract(data, '$.skillId') AS skillId, json_extract(data, '$.status') AS status, json_extract(data, '$.createdAt') AS createdAt, json_extract(data, '$.model') AS model";
const unpack = row => row ? JSON.parse(row.data) : undefined;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, updatedAt TEXT NOT NULL, data TEXT NOT NULL)');
    this.db.exec(`CREATE INDEX IF NOT EXISTS runs_recent ON runs(updatedAt DESC, id ASC);
      CREATE INDEX IF NOT EXISTS runs_thread ON runs(json_extract(data, '$.threadId'));
      CREATE INDEX IF NOT EXISTS runs_status ON runs(json_extract(data, '$.status'));`);
    // Full-text matching runs only for an explicit search, never during streaming.
    this.db.function('studio_matches', { deterministic: true }, (data, query) => {
      const run = JSON.parse(data);
      return Number([run.title || '', run.skillId || '', ...(run.messages || []).map(message => message.text || '')].some(text => text.toLowerCase().includes(query)));
    });
    this.put = this.db.prepare('INSERT INTO runs (id, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data');
    this.find = this.db.prepare('SELECT data FROM runs WHERE id = ?');
    this.all = this.db.prepare('SELECT data FROM runs ORDER BY updatedAt DESC, id ASC');
    this.activeSummary = this.db.prepare(`SELECT ${summary} FROM runs WHERE ${active} LIMIT 1`);
    this.active = this.db.prepare(`SELECT data FROM runs WHERE ${active}`);
    this.hasWorking = this.db.prepare(`SELECT id FROM runs WHERE ${active} LIMIT 1`);
    this.byThread = this.db.prepare("SELECT data FROM runs WHERE json_extract(data, '$.threadId') = ? LIMIT 1");
    this.byRequest = this.db.prepare(`SELECT data FROM runs WHERE ${active} AND EXISTS (SELECT 1 FROM json_each(runs.data, '$.pending') AS pending WHERE json_extract(pending.value, '$.rpcId') = ?) LIMIT 1`);
    // Old process RPC identifiers cannot be answered after restart.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const run of this.activeRuns()) this.save({ ...run, status: 'interrupted', pending: [], updatedAt: new Date().toISOString(), error: 'Backend restarted. Continue this run to reconnect to its Codex conversation; any pending approval must be requested again.' });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  list() { return this.all.all().map(unpack); }
  getActiveSummary() { return this.activeSummary.get() || null; }
  activeRuns() { return this.active.all().map(unpack); }
  hasActive() { return !!this.hasWorking.get(); }
  findByThread(id) { return typeof id === 'string' ? unpack(this.byThread.get(id)) : undefined; }
  findByRequest(id) { return typeof id === 'string' || typeof id === 'number' ? unpack(this.byRequest.get(id)) : undefined; }
  get(id) { return unpack(this.find.get(id)); }
  history({ query = '', limit = 50, offset = 0 } = {}) {
    if (typeof query !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('Invalid history pagination.'), { status: 400 });
    const search = query.trim().toLowerCase(), where = search ? ' WHERE studio_matches(data, ?)' : '', params = search ? [search] : [];
    const total = this.db.prepare('SELECT count(*) AS total FROM runs' + where).get(...params).total;
    const runs = this.db.prepare(`SELECT ${summary} FROM runs${where} ORDER BY updatedAt DESC, id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { runs, total, nextOffset: offset + runs.length < total ? offset + runs.length : null };
  }
  save(run) {
    if (typeof run.id !== 'string' || !run.id || typeof run.updatedAt !== 'string' || !run.updatedAt) throw new TypeError('Runs require an id and updatedAt timestamp.');
    this.put.run(run.id, run.updatedAt, JSON.stringify(run));
  }
  close() { this.db.close(); }
}
