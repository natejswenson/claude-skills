// Baseline eval: lintPost pinned against entries that were really published.
//
// Offline, deterministic, $0 — runs in `ci / devlog` with the normal suite.
//
// tests/lint_post.test.mjs unit-tests each rule against small crafted inputs, and
// tests/evals.test.mjs already drives the good/bad/irreproducible fixtures through
// the judge in both directions. Both use hand-authored posts written to exercise
// the rules. Neither answers: does the linter still accept the real thing?
//
// evals/baseline/published/ holds eight entries copied verbatim from
// natejswenson.io — posts that went through the full pipeline, were reviewed, and
// are live. They are the only corpus where "this passes" means "a human shipped
// this and stands behind it". A rule that grows too strict starts rejecting work
// like this, and the cost lands at publish time on a real release.
//
// Deliberately a CURATED subset, not the whole site. Of 61 published entries only
// 17 satisfy today's contract; the rest predate rules that landed later (the 5-10
// `tags-count` range especially). Those are stale, not bad — asserting over all 61
// would encode "the linter must accept its own history", which is a different and
// wrong requirement. The frozen eight are recent version releases across four
// projects, each verified clean at freeze time.
//
// The other direction is already covered by tests/evals.test.mjs (bad-post.md must
// fail layer 1; irreproducible-post.md must fail the judge), so this file adds the
// half that was missing rather than duplicating it — plus a guard that lintPost
// still reports findings at all, since every assertion here is "expect zero
// findings" and a linter that returned nothing would satisfy all of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintPost } from '../lib/lint_post.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED_DIR = join(SKILL_ROOT, 'evals', 'baseline', 'published');
const FIXTURES_DIR = join(SKILL_ROOT, 'evals', 'fixtures');

const INVARIANTS = JSON.parse(
  readFileSync(join(SKILL_ROOT, 'skill-invariants.json'), 'utf8')
);
const BASELINE = Object.fromEntries(INVARIANTS.baseline.map((b) => [b.id, b]));
const MIN_CORPUS = BASELINE['published-entries-still-lint-clean'].min_corpus;

const published = readdirSync(PUBLISHED_DIR).filter((f) => f.endsWith('.md'));

test('baseline: the published corpus is large enough to be meaningful', () => {
  // Anti-vacuity: every per-entry test below is generated from this list. If the
  // directory ever empties or the glob stops matching, zero tests run and the
  // file reports green while checking nothing.
  assert.ok(
    published.length >= MIN_CORPUS,
    `Found ${published.length} published entries in evals/baseline/published, ` +
      `below the declared floor of ${MIN_CORPUS}. Either the fixtures moved or ` +
      `the corpus shrank — do not let this suite run over an empty directory.`
  );
});

// Fixtures are stored as `<project>-<version>.md` so eight entries from four
// projects can share one flat directory. lintPost's `filename-version` rule
// compares the filename against the frontmatter version, so it must be handed
// the ORIGINAL `<version>.md` name — not the prefixed fixture name.
function originalFilename(fixtureName) {
  const m = /(v\d[\d.]*\.md)$/.exec(fixtureName);
  assert.ok(
    m,
    `Fixture ${fixtureName} does not end in a v<version>.md segment, so the ` +
      `filename-version rule would be checked against the wrong name.`
  );
  return m[1];
}

for (const file of published) {
  test(`baseline: published entry stays lint-clean — ${file}`, () => {
    const { ok, findings } = lintPost(readFileSync(join(PUBLISHED_DIR, file), 'utf8'), {
      filename: originalFilename(file),
    });
    assert.deepEqual(
      findings.map((f) => `${f.rule}: ${f.message}`),
      [],
      `${file} is a real, published, human-reviewed entry, but lintPost now ` +
        `rejects it. This is a FALSE POSITIVE in the linter, not a bad post — ` +
        `the rule would block a real release. Narrow the rule; do not edit the ` +
        `frozen entry to appease it.`
    );
    assert.equal(ok, true);
  });
}

test('baseline: lintPost still reports findings on a post that violates the contract', () => {
  // Without this, every assertion above is satisfied by a linter that returns
  // an empty findings array unconditionally.
  const { ok, findings } = lintPost(readFileSync(join(FIXTURES_DIR, 'bad-post.md'), 'utf8'), {
    filename: 'bad-post.md',
  });
  assert.equal(ok, false, 'bad-post.md must not lint clean');
  assert.ok(
    findings.length > 0,
    'lintPost returned no findings for the known-bad fixture — the linter has ' +
      'stopped detecting anything, which makes the whole published corpus above ' +
      'pass vacuously.'
  );
});

test('baseline: the required-section rules are still enforced', () => {
  // Names the specific rules the published corpus depends on, so deleting one
  // fails here rather than silently widening what counts as acceptable.
  const stripped = `---
title: A post with no sections
date: 2026-07-20
project: devlog
version: v0.1.0
tags: [a, b, c, d, e]
summary: Something shipped.
---

Just prose, no required sections at all.
`;
  const rules = new Set(lintPost(stripped, { filename: 'v0.1.0.md' }).findings.map((f) => f.rule));
  for (const expected of ['section-shipped', 'section-gotchas', 'section-sources']) {
    assert.ok(
      rules.has(expected),
      `lintPost no longer emits '${expected}' for a post missing every required ` +
        `section. Got: ${[...rules].join(', ') || '(none)'}`
    );
  }
});
