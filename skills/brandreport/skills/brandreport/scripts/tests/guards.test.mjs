import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const FIXTURES = join(SKILL, 'evals', 'fixtures');

// Hand-written regression guards. They live OUTSIDE baseline.test.mjs on
// purpose: `skillfactory freeze` regenerates that file wholesale, deleting
// anything added to it by hand.

const metas = readdirSync(FIXTURES, { recursive: true })
  .filter((f) => String(f).endsWith('.meta.json'))
  .map((f) => ({
    dir: dirname(join(FIXTURES, String(f))),
    ...JSON.parse(readFileSync(join(FIXTURES, String(f)), 'utf8')),
  }));

test('the fixture corpus is not vacuous', () => {
  // Anti-vacuity floor: the real run filed 11 snapshots and the trap 1. A
  // refresh that collapses this corpus would pass every scan below over
  // nothing and call it clean.
  assert.ok(metas.length >= 12, `fixture corpus shrank to ${metas.length} sidecars — the guards below are scanning almost nothing`);
});

test('no real stranger reaches the frozen corpus', () => {
  // The one exception rule (CLAUDE.md step 10): a corpus that is somebody's
  // life gets INVENTED, never redacted. Structurally: every unconfirmed
  // snapshot — a same-name stranger by definition — must live on a reserved
  // .example domain, and its artifact must not reference any real host.
  // This catches a leaked real identity without committing a blocklist of
  // real identities to a public repo.
  const unconfirmed = metas.filter((m) => m.status === 'unconfirmed');
  assert.ok(unconfirmed.length >= 4, 'the stranger fixtures vanished');
  for (const m of unconfirmed) {
    assert.ok(new URL(m.url).hostname.endsWith('.example'),
      `${m.id} (${m.url}): an unconfirmed snapshot in a committed corpus must be invented, on a .example domain`);
    const body = readFileSync(join(m.dir, m.file), 'utf8');
    for (const host of body.matchAll(/https?:\/\/([^\s/")]+)/g)) {
      assert.ok(host[1].endsWith('.example'), `${m.id}'s artifact references a real host: ${host[1]}`);
    }
    for (const bare of body.matchAll(/(?<![\w@.])([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(?=\S)/g)) {
      assert.ok(bare[1].endsWith('.example'), `${m.id}'s artifact references a real host: ${bare[1]}`);
    }
  }
});

test('every confirmed fixture snapshot records its corroboration', () => {
  // The frozen corpus must itself satisfy the one rule — a refresh that
  // strips corroborations would still render, because gate runs before
  // report, but this pins it at the corpus level too.
  for (const m of metas.filter((x) => x.status === 'confirmed')) {
    assert.ok(String(m.corroboration ?? '').trim().length > 0, `${m.id} is confirmed with no recorded tie`);
  }
});
