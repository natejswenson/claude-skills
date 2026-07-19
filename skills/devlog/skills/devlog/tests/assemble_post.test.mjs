import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assemblePost, writeAssembledBlocks } from '../lib/assemble_post.mjs';

const POST = `---
title: "T"
date: 2026-07-11
project: proj
version: v0.1.0
tags: [a]
summary: "S"
---

## Shipped

Intro prose.

\`\`\`python
print("one")
\`\`\`

## Build it

\`\`\`bash
echo two
\`\`\`

Expected output:

\`\`\`text
two
\`\`\`

\`\`\`weirdlang
mystery three
\`\`\`
`;

test('assemblePost returns ordered blocks and marks output fences non-runnable', () => {
  const blocks = assemblePost(POST);
  assert.deepEqual(blocks.map((b) => [b.index, b.lang, b.runnable]), [
    [1, 'python', true],
    [2, 'bash', true],
    [3, 'text', false],
    [4, 'weirdlang', true],
  ]);
  assert.equal(blocks[0].code, 'print("one")');
  assert.equal(blocks[2].code, 'two');
});

test('writeAssembledBlocks writes numbered files for runnable blocks only', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'devlog-assemble-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));

  const result = writeAssembledBlocks(POST, out);
  assert.equal(result.runnableCount, 3);
  assert.equal(result.outputBlockCount, 1);
  assert.deepEqual(readdirSync(out).sort(), ['01.py', '02.sh', '04.txt']);
  assert.equal(readFileSync(join(out, '01.py'), 'utf8'), 'print("one")\n');
  assert.equal(readFileSync(join(out, '02.sh'), 'utf8'), 'echo two\n');
  // The text block appears in the manifest with file: null.
  const textBlock = result.blocks.find((b) => b.index === 3);
  assert.equal(textBlock.runnable, false);
  assert.equal(textBlock.file, null);
});

test('assemblePost handles a post with no fences and unterminated fences safely', () => {
  assert.deepEqual(assemblePost('## Shipped\n\nProse only.'), []);
  // An unterminated fence yields no block (never a crash or runaway capture).
  assert.deepEqual(assemblePost('## Shipped\n\n```js\nlet x = 1;'), []);
});
