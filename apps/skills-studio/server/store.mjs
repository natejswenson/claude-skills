import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, updatedAt TEXT NOT NULL, data TEXT NOT NULL)');
    this.put = this.db.prepare('INSERT INTO runs (id, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data');
    this.find = this.db.prepare('SELECT data FROM runs WHERE id = ?');
    this.all = this.db.prepare('SELECT data FROM runs ORDER BY updatedAt DESC, id ASC');
    // RPC request IDs belong to the old process and cannot be answered after restart.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const run of this.list()) {
        if (!['working', 'approval_needed', 'awaiting_input'].includes(run.status)) continue;
        this.save({ ...run, status: 'interrupted', pending: [], updatedAt: new Date().toISOString(), error: 'Backend restarted. Continue this run to reconnect to its Codex conversation; any pending approval must be requested again.' });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }

  list() { return this.all.all().map(row => JSON.parse(row.data)); }
  get(id) {
    const row = this.find.get(id);
    return row ? JSON.parse(row.data) : undefined;
  }
  save(run) {
    if (typeof run.id !== 'string' || !run.id || typeof run.updatedAt !== 'string' || !run.updatedAt) throw new TypeError('Runs require an id and updatedAt timestamp.');
    this.put.run(run.id, run.updatedAt, JSON.stringify(run));
  }
  close() { this.db.close(); }
}
