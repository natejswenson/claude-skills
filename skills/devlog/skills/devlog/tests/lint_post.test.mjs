import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lintPost,
  parseFrontmatter,
  splitSections,
  findUntaggedFences,
  extractSourceUrls,
} from '../lib/lint_post.mjs';

// A post that satisfies the full deterministic contract. Tests mutate this.
const GOOD = `---
title: "Testing the seams between generated files"
date: 2026-07-11
project: proj
version: v0.5.0
tags: [testing, ci-cd]
summary: "What a contract test between two generated files actually buys you."
---

## Shipped

This release added a [contract test](https://martinfowler.com/bliki/ContractTest.html).
The rest of this post shows how to build one.

## Build the harvester

Consumer-driven contracts ([Pact docs](https://docs.pact.io/)) put the check at the seam.

\`\`\`python
def harvest(css: str) -> set[str]:
    return set(re.findall(r"\\.([a-z-]+)", css))
\`\`\`

## Gotchas

- Doc comments containing \`class="..."\` produce false positives — strip comments
  before harvesting, or the test fails on classes that don't exist. Keep the check
  low in the pyramid ([Google Testing Blog](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)).

## Sources

- [Contract testing](https://martinfowler.com/bliki/ContractTest.html) — definition
- [Pact docs](https://docs.pact.io/) — consumer-driven contracts
- [Google Testing Blog](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html) — test pyramid

## Changelog

- feat: add contract test ([abc1234](https://github.com/me/proj/commit/abc1234))
`;

test('lintPost passes a conforming post', () => {
  const r = lintPost(GOOD, { minSources: 3, filename: 'v0.5.0.md' });
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test('lintPost fails when frontmatter is absent', () => {
  const r = lintPost('# Just a heading\n\nSome text.');
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].rule, 'frontmatter-missing');
});

test('lintPost flags each missing frontmatter field', () => {
  const r = lintPost(GOOD.replace('summary: "What a contract test between two generated files actually buys you."\n', ''));
  assert.ok(r.findings.some((f) => f.rule === 'frontmatter-summary'));
});

test('lintPost flags bad date and version formats', () => {
  const r = lintPost(GOOD.replace('date: 2026-07-11', 'date: July 11').replace('version: v0.5.0', 'version: 0.5.0'), { filename: null });
  assert.ok(r.findings.some((f) => f.rule === 'date-format'));
  assert.ok(r.findings.some((f) => f.rule === 'version-format'));
});

test('lintPost rejects changelog-style titles', () => {
  const r = lintPost(GOOD.replace('title: "Testing the seams between generated files"', 'title: "Release v0.5.0"'));
  assert.ok(r.findings.some((f) => f.rule === 'title-style'));
});

test('lintPost enforces 2-5 tags', () => {
  const one = lintPost(GOOD.replace('tags: [testing, ci-cd]', 'tags: [testing]'));
  assert.ok(one.findings.some((f) => f.rule === 'tags-count'));
  const six = lintPost(GOOD.replace('tags: [testing, ci-cd]', 'tags: [a, b, c, d, e, f]'));
  assert.ok(six.findings.some((f) => f.rule === 'tags-count'));
});

test('lintPost checks filename matches version', () => {
  const r = lintPost(GOOD, { minSources: 3, filename: '/tmp/drafts/v0.4.0.md' });
  assert.ok(r.findings.some((f) => f.rule === 'filename-version'));
});

test('lintPost requires Shipped, Gotchas, and Sources sections', () => {
  const noGotchas = GOOD.replace(/## Gotchas[\s\S]*?(?=## Sources)/, '');
  const r = lintPost(noGotchas);
  assert.ok(r.findings.some((f) => f.rule === 'section-gotchas'));

  const noShipped = GOOD.replace(/## Shipped[\s\S]*?(?=## Build)/, '');
  assert.ok(lintPost(noShipped).findings.some((f) => f.rule === 'section-shipped'));
});

test('lintPost flags an effectively empty Gotchas section', () => {
  const hollow = GOOD.replace(/## Gotchas[\s\S]*?(?=## Sources)/, '## Gotchas\n\n- None.\n\n');
  const r = lintPost(hollow);
  assert.ok(r.findings.some((f) => f.rule === 'gotchas-empty'));
});

test('lintPost counts DISTINCT source URLs against minSources', () => {
  // Same URL three times = one distinct source.
  const dupes = GOOD.replace(/## Sources[\s\S]*?(?=## Changelog)/, `## Sources

- [A](https://example.com/one) — x
- [B](https://example.com/one) — y
- [C](https://example.com/one) — z

`);
  const r = lintPost(dupes, { minSources: 3 });
  assert.ok(r.findings.some((f) => f.rule === 'sources-count'));
  // The same post clears the count check with minSources 1 (it still fails
  // sources-inline, which is that rule's job, not this one's).
  assert.ok(!lintPost(dupes, { minSources: 1 }).findings.some((f) => f.rule === 'sources-count'));
});

test('lintPost flags untagged code fences with line numbers', () => {
  const untagged = GOOD.replace('```python', '```');
  const r = lintPost(untagged);
  const finding = r.findings.find((f) => f.rule === 'fence-untagged');
  assert.ok(finding);
  assert.match(finding.message, /line \d+/);
});

// ─── helper units ─────────────────────────────────────────────────────────────

test('parseFrontmatter strips quotes and parses flow arrays', () => {
  const { data, body } = parseFrontmatter('---\ntitle: "Quoted"\ntags: [a, b]\n---\nBody.');
  assert.equal(data.title, 'Quoted');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.equal(body, 'Body.');
});

test('parseFrontmatter returns null data without a fence', () => {
  assert.equal(parseFrontmatter('no fence here').data, null);
  assert.equal(parseFrontmatter('---\nunclosed: true\n').data, null);
});

test('parseFrontmatter uses a prototype-free object', () => {
  const { data } = parseFrontmatter('---\ntitle: x\n---\n');
  assert.equal(Object.getPrototypeOf(data), null);
});

test('splitSections ignores ## headings inside code fences', () => {
  const sections = splitSections('## Real\n\n```bash\n## not a heading\n```\n\n## Also Real\ntext');
  assert.deepEqual(sections.map((s) => s.heading), ['Real', 'Also Real']);
  assert.ok(sections[0].content.includes('## not a heading'));
});

test('splitSections does not treat ### subheadings as sections', () => {
  const sections = splitSections('## Top\n### Sub\ncontent');
  assert.deepEqual(sections.map((s) => s.heading), ['Top']);
});

test('findUntaggedFences reports only opening fences', () => {
  assert.deepEqual(findUntaggedFences('```js\ncode\n```\n\n```\ncode\n```'), [5]);
  assert.deepEqual(findUntaggedFences('no fences'), []);
});

test('extractSourceUrls dedupes and only accepts http(s)', () => {
  const urls = extractSourceUrls('- [A](https://a.com) [B](https://a.com) [C](http://c.com) [D](javascript:alert(1))');
  assert.deepEqual([...urls].sort(), ['http://c.com', 'https://a.com']);
});

test('lintPost flags a Sources URL never cited inline', () => {
  const post = GOOD.replace(
    '## Sources',
    `## Sources

- [Uncited extra](https://example.com/uncited) — never referenced in prose`,
  );
  const r = lintPost(post, { minSources: 3, filename: 'v0.5.0.md' });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.rule === 'sources-inline'
    && f.message.includes('https://example.com/uncited')));
});

test('sources-inline tolerates trailing-slash and fragment differences', () => {
  const post = GOOD
    .replace('https://docs.pact.io/)', 'https://docs.pact.io/#intro)');
  const r = lintPost(post, { minSources: 3, filename: 'v0.5.0.md' });
  assert.ok(!r.findings.some((f) => f.rule === 'sources-inline'), JSON.stringify(r.findings));
});
