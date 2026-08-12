import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const NETWATCH = join(SKILL, 'scripts', 'netwatch.js');
const CAPTURE = join(SKILL, 'evals', 'baseline', 'capture.txt');

// A fresh copy of the real frozen capture per test, plus an empty baseline —
// never write into the frozen fixtures themselves.
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), 'netwatch-accept-'));
  copyFileSync(CAPTURE, join(dir, 'capture.txt'));
  writeFileSync(join(dir, 'baseline.json'), '[]');
  return dir;
}

const run = (args, cwd) => execFileSync('node', [NETWATCH, ...args], { cwd, encoding: 'utf8' });

test('floor: the fixture capture still holds the destination the good-entry cases below rely on', () => {
  const dir = freshDir();
  const out = run(['flows', '--snapshot', 'capture.txt'], dir);
  assert.match(out, /216\.24\.57\.7/, 'if this destination is ever removed from the frozen capture, the no-warning cases below would pass over nothing');
});

test('accept --snapshot: a new entry matching zero flows is reported and warned about', () => {
  const dir = freshDir();
  const out = run(['accept', '--baseline', 'baseline.json', '--host', '203.0.113.', '--note', 'deliberately unmatched', '--snapshot', 'capture.txt'], dir);
  assert.match(out, /\|\s*Added to baseline\s*\|.*\bMatches now\b.*\|/, 'the column must exist');
  assert.match(out, /\|\s*203\.0\.113\.\s*\|\s*\*\s*\|\s*\*\s*\|\s*0\s*\|/, 'a zero-match entry must print 0, not be silently omitted');
  assert.match(out, /zero-match warning/i);
  assert.match(out, /"203\.0\.113\."/, 'the warning must name the entry it is about');
});

test('accept --snapshot: an entry that matches something prints a nonzero count and no warning', () => {
  const dir = freshDir();
  const out = run(['accept', '--baseline', 'baseline.json', '--host', '216.24.57.', '--note', 'Render', '--snapshot', 'capture.txt'], dir);
  assert.match(out, /\|\s*216\.24\.57\.\s*\|\s*\*\s*\|\s*\*\s*\|\s*[1-9]\d*\s*\|/, 'a matching entry must report a nonzero count');
  assert.doesNotMatch(out, /zero-match warning/i);
});

test('accept with no --snapshot: coverage reads "not checked", never a silent number, and never a warning', () => {
  const dir = freshDir();
  const out = run(['accept', '--baseline', 'baseline.json', '--host', '203.0.113.', '--note', 'test'], dir);
  assert.match(out, /\|\s*203\.0\.113\.\s*\|\s*\*\s*\|\s*\*\s*\|\s*not checked\s*\|/);
  assert.match(out, /coverage not checked/);
  assert.doesNotMatch(out, /zero-match warning/i, 'without a snapshot there is nothing to warn about — silence, not a false alarm');
});

test('a zero-match entry is a warning, not a refusal — accept still exits 0', () => {
  const dir = freshDir();
  // execFileSync throws on a nonzero exit; reaching the assertion below is the test.
  run(['accept', '--baseline', 'baseline.json', '--host', '203.0.113.', '--note', 'test', '--snapshot', 'capture.txt'], dir);
  assert.ok(true, 'accept did not exit non-zero on a zero-match entry');
});

test("the issue's own scenario, end to end: fe80: now covers the reported flow and report shows it known", () => {
  const dir = freshDir();
  const acceptOut = run(['accept', '--baseline', 'baseline.json', '--host', 'fe80:', '--process', 'identityservicesd',
    '--note', 'Apple Continuity / Handoff over link-local', '--snapshot', 'capture.txt'], dir);
  assert.doesNotMatch(acceptOut, /zero-match warning/i, "the reporter's own keystroke must not warn now that IPv6 prefixes work");
  assert.match(acceptOut, /\|\s*fe80:\s*\|\s*identityservicesd\s*\|\s*\*\s*\|\s*2\s*\|/, 'both identityservicesd flows to that address must be counted');

  const reportOut = run(['report', '--snapshot', 'capture.txt', '--baseline', 'baseline.json'], dir);
  const unrecSection = reportOut.slice(reportOut.indexOf('UNRECOGNIZED'), reportOut.indexOf('KNOWN'));
  const knownSection = reportOut.slice(reportOut.indexOf('KNOWN'));
  assert.doesNotMatch(unrecSection, /identityservicesd/, 'the accepted flows must leave UNRECOGNIZED — exactly the promise SKILL.md makes');
  assert.match(knownSection, /identityservicesd/, 'the accepted flows must now read KNOWN');
});
