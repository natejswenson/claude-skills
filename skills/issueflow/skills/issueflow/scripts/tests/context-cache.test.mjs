import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedContext, buildContextPacket, prepareReviewContext, verifyContextSources } from '../lib/context.mjs';

test('cache reuses identical inputs and invalidates changed source, guidance, plan and head', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-context-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = join(root, 'repo'); mkdirSync(tree); const cache = join(root, 'cache'); const plan = join(root, 'plan.md');
  writeFileSync(join(tree, 'a.js'), 'export const a = 1;'); writeFileSync(join(tree, 'AGENTS.md'), 'Keep tests.'); writeFileSync(plan, 'Approved plan');
  const input = { head: 'first', base: 'base', files: ['a.js'], plan, contract: { criteria: [{ id: 'C1', description: 'must not be truncated' }] } };
  const first = prepareReviewContext(cache, tree, input, { excerptBytes: 8 });
  assert.equal(first.hit, false); assert.equal(prepareReviewContext(cache, tree, input, { excerptBytes: 8 }).hit, true);
  assert.deepEqual(first.packet.contract, input.contract); assert.ok(first.packet.sources.some((s) => s.omission || s.excerpt.summarized));
  assert.equal(verifyContextSources(first.packet, tree), true);
  for (const path of [join(tree, 'a.js'), join(tree, 'AGENTS.md'), plan]) {
    writeFileSync(path, readFileSync(path, 'utf8') + '\nchanged');
    assert.equal(verifyContextSources(first.packet, tree), false);
    assert.equal(prepareReviewContext(cache, tree, input, { excerptBytes: 8 }).hit, false);
  }
  assert.equal(prepareReviewContext(cache, tree, { ...input, head: 'second' }, { excerptBytes: 8 }).hit, false);
});

test('cache hits avoid rebuilding and corrupted entries are retained, never trusted', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-cache-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  let builds = 0; const build = () => { builds++; return buildContextPacket({ head: 'a' }); };
  const first = cachedContext(root, { head: 'a' }, build);
  for (let n = 0; n < 20; n++) assert.equal(cachedContext(root, { head: 'a' }, build).hit, true);
  assert.equal(builds, 1);
  writeFileSync(join(root, `${first.key}.json`), '{broken');
  assert.equal(cachedContext(root, { head: 'a' }, build).hit, false); assert.equal(builds, 2);
});
