import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bodyHash,
  endMarker,
  findRegion,
  initRegion,
  RegionError,
  renderRegion,
  spliceRegion,
  startMarker,
} from '../lib/region.mjs';

const V = '9.9.9';

const pyFile = [
  '"""module docstring."""',
  'from __future__ import annotations',
  '',
  startMarker('python', 'tokens', V, bodyHash('X = 1')),
  'X = 1',
  endMarker('python', 'tokens'),
  '',
  'def stylesheet():',
  '    return "hand written"',
].join('\n');

test('findRegion locates a region and reports its receipt', () => {
  const found = findRegion(pyFile, 'tokens', 'python');
  assert.equal(found.body, 'X = 1');
  assert.equal(found.version, V);
  assert.equal(found.hash, bodyHash('X = 1'));
});

test('findRegion returns null when the file has no region', () => {
  assert.equal(findRegion('just some text\n', 'tokens', 'python'), null);
});

test('a region that opens but never closes is an error, not a silent null', () => {
  const broken = `${startMarker('css', 'tokens', V, 'abc')}\n:root {}\n`;
  assert.throws(() => findRegion(broken, 'tokens', 'css'), RegionError);
});

test('a file declaring the same region twice is an error', () => {
  const twice = [
    startMarker('css', 'tokens', V, 'a'),
    'a',
    endMarker('css', 'tokens'),
    startMarker('css', 'tokens', V, 'b'),
    'b',
    endMarker('css', 'tokens'),
  ].join('\n');
  assert.throws(() => findRegion(twice, 'tokens', 'css'), RegionError);
});

test('splice replaces only the region — hand-written code either side survives', () => {
  const after = spliceRegion(pyFile, 'tokens', 'python', 'X = 2', V);
  assert.match(after, /^"""module docstring\."""/);
  assert.match(after, /def stylesheet\(\):\n {4}return "hand written"/);
  assert.equal(findRegion(after, 'tokens', 'python').body, 'X = 2');
});

test('splice refuses a file with no region rather than appending silently', () => {
  assert.throws(() => spliceRegion('nothing here\n', 'tokens', 'python', 'X = 1', V), RegionError);
});

test('the receipt hash changes with the body and is stable for identical bodies', () => {
  assert.notEqual(bodyHash('X = 1'), bodyHash('X = 2'));
  assert.equal(bodyHash('X = 1\n\n  '), bodyHash('X = 1'));
});

test('init with a replace anchor swallows the legacy block instead of leaving a duplicate', () => {
  const legacy = [
    '# header',
    'LEGACY_START = 1',
    'middle = 2',
    'LEGACY_END = 3',
    '# trailer',
  ].join('\n');
  const after = initRegion(legacy, 'tokens', 'python', 'NEW = 1', V, {
    replaceFrom: '^LEGACY_START',
    replaceTo: '^LEGACY_END',
  });
  assert.doesNotMatch(after, /LEGACY_START|middle = 2|LEGACY_END/);
  assert.match(after, /# header/);
  assert.match(after, /# trailer/);
  assert.equal(findRegion(after, 'tokens', 'python').body, 'NEW = 1');
});

test('init with no anchor appends, and refuses to run twice', () => {
  const once = initRegion('body\n', 'tokens', 'md', 'hello', V);
  assert.match(once, /^body/);
  assert.equal(findRegion(once, 'tokens', 'md').body, 'hello');
  assert.throws(() => initRegion(once, 'tokens', 'md', 'hello', V), RegionError);
});

test('an anchor that matches nothing is an error, not a no-op', () => {
  assert.throws(
    () => initRegion('a\nb\n', 'tokens', 'python', 'X', V, { replaceFrom: '^NOPE$' }),
    RegionError,
  );
});

test('each syntax round-trips through its own comment form', () => {
  for (const syntax of ['python', 'css', 'md']) {
    const text = `head\n${renderRegion('tokens', syntax, 'body line', V)}\ntail\n`;
    assert.equal(findRegion(text, 'tokens', syntax).body, 'body line', syntax);
  }
});

test('a css region is not found when read as python', () => {
  const css = renderRegion('tokens', 'css', 'x', V);
  assert.equal(findRegion(css, 'tokens', 'python'), null);
});

test('an unknown syntax is rejected', () => {
  assert.throws(() => renderRegion('tokens', 'ruby', 'x', V), RegionError);
});
