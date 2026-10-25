import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';

test('restart interrupts output collection and preserves already collected artifacts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'runs.sqlite');
  const initial = new Store(path);
  initial.save({ id: 'collecting', updatedAt: new Date().toISOString(), status: 'collecting_output', pending: [], artifacts: [{ id: 'output', name: 'report.md' }] });
  initial.close();
  const reopened = new Store(path);
  t.after(() => reopened.close());
  const run = reopened.get('collecting');
  assert.equal(run.status, 'interrupted');
  assert.match(run.error, /Backend restarted/);
  assert.deepEqual(run.artifacts, [{ id: 'output', name: 'report.md' }]);
});
