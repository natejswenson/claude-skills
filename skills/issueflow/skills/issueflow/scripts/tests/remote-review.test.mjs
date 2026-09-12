import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, loadRun, saveRun } from '../lib/run.mjs';
import { reconcileReview } from '../lib/remote-review.mjs';

function fixture(t, fault) {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-remote-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = createRun({ strict: true, repo: { path: dir }, issue: { number: 1, title: 'test' }, policy: { base: 'main' } });
  const lane = run.lanes[0]; lane.pr = { url: 'https://example.invalid/pr/1', nodeId: 'PR' };
  lane.review.findings = [{ id: 'F1' }]; lane.review.rounds = [{ head: 'HEAD', round: 1 }]; saveRun(dir, run);
  const remote = { reviews: [], threads: [], comments: [{ id: 'old', nodes: [], resolved: false }], writes: {} };
  const written = (kind) => { remote.writes[kind] = (remote.writes[kind] ?? 0) + 1; if (fault === kind) throw new Error('connection lost after effect'); };
  const gateway = {
    reviews: () => structuredClone(remote.reviews), threads: () => structuredClone(remote.threads),
    comments: (id) => structuredClone(remote.comments.find((c) => c.id === id)),
    create: (body) => { remote.reviews.push({ id: 'R1', body, mine: true, state: 'PENDING', commit: { oid: 'HEAD' } }); written('create'); },
    thread: (review, t) => { remote.threads.push({ id: 'T1', path: t.path, line: t.line, comments: [{ body: t.body, mine: true, pullRequestReview: { id: review } }] }); written('thread'); },
    submit: (review, body) => { Object.assign(remote.reviews[0], { body, state: 'COMMENTED', url: 'https://example.invalid/review/1' }); written('submit'); },
    reply: (id, body) => { remote.comments[0].nodes.push({ id: 'C1', body, mine: true }); written('reply'); },
    resolve: () => { remote.comments[0].resolved = true; written('resolve'); },
  };
  const payload = { body: 'Observed review result', threads: [{ id: 'F1', path: 'a.js', line: 1, side: 'RIGHT', body: 'finding one' }], replies: [{ id: 'prior', threadId: 'old', body: 'fixed by reviewed change', resolve: true }] };
  return { dir, run, remote, gateway, payload };
}

for (const fault of ['create', 'thread', 'submit', 'reply', 'resolve']) test(`lost ${fault} acknowledgement reconciles without duplicate remote work`, (t) => {
  const f = fixture(t, fault);
  const post = (run) => reconcileReview(f.dir, run, run.lanes[0], run.lanes[0].review.rounds[0], f.payload, f.gateway);
  assert.equal(post(f.run).url, 'https://example.invalid/review/1');
  assert.equal(post(loadRun(f.dir)).url, 'https://example.invalid/review/1');
  assert.deepEqual(f.remote.writes, { create: 1, thread: 1, submit: 1, reply: 1, resolve: 1 });
  assert.ok(Object.values(loadRun(f.dir).operations).every((op) => op.state === 'confirmed'));
});

test('interrupted read-back preserves uncertain review, then resumes from remote evidence', (t) => {
  const f = fixture(t); const read = f.gateway.reviews; let unavailable = false;
  const create = f.gateway.create;
  f.gateway.create = (body) => { create(body); unavailable = true; throw new Error('lost ack'); };
  f.gateway.reviews = () => { if (unavailable) throw new Error('read unavailable'); return read(); };
  assert.throws(() => reconcileReview(f.dir, f.run, f.run.lanes[0], f.run.lanes[0].review.rounds[0], f.payload, f.gateway), /unconfirmed/);
  assert.equal(loadRun(f.dir).lanes[0].review.rounds[0].posted, undefined);
  unavailable = false; const run = loadRun(f.dir);
  reconcileReview(f.dir, run, run.lanes[0], run.lanes[0].review.rounds[0], f.payload, f.gateway);
  assert.equal(f.remote.writes.create, 1);
});

test('another author or wrong head cannot supply a review receipt', (t) => {
  const f = fixture(t); f.gateway.create = (body) => { f.remote.reviews.push({ id: 'foreign', mine: false, body, commit: { oid: 'OTHER' } }); };
  assert.throws(() => reconcileReview(f.dir, f.run, f.run.lanes[0], f.run.lanes[0].review.rounds[0], f.payload, f.gateway), /unconfirmed/);
  assert.equal(f.run.lanes[0].review.rounds[0].posted, undefined);
});
