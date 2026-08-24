import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ERRORS, explain } from '../lib/errors.mjs';
import { compactSendTable, resultOf, summarize } from '../lib/report.mjs';
import { verdict } from '../lib/verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');

test('every error code the CLI can raise is documented in references/errors.md', () => {
  const md = readFileSync(join(SKILL, 'references', 'errors.md'), 'utf8');
  const undocumented = Object.keys(ERRORS).filter((code) => !['interrupted', 'usage'].includes(code) && !md.includes(`\`${code}\``));
  assert.deepEqual(undocumented, [], `add rows to errors.md for: ${undocumented.join(', ')}`);
  assert.match(explain('nope_never').fix, /--debug/);
});

const st = (o = {}) => ({ power: 'on', app: { name: 'Netflix', id: 'com.netflix.Netflix' }, focus: 'unfocused', volume: 30, playing: { device_state: 'playing', title: 'X', position: 1 }, unsupported: {}, ...o });
const cap = (command, before, after, arg = null) => ({ command, arg, sent: { ok: true }, before, after });

test('the compact table collapses keypress runs and says "sent", never "unverifiable"', () => {
  const caps = [
    cap('turn_on', st({ power: 'off' }), st({ power: 'on' })),
    cap('down', st(), st()), cap('down', st(), st()), cap('down', st(), st()),
    cap('select', st(), st()),
  ];
  const t = compactSendTable(caps);
  assert.match(t, /\| 1 +\| turn_on +\| verified \(off → on\)/);
  assert.match(t, /\| 2–4 +\| down ×3 +\| sent/);
  assert.match(t, /\| 5 +\| select +\| sent/);
  assert.doesNotMatch(t, /unverifiable/);
  assert.equal(resultOf(caps[0], verdict(caps[0])), 'verified (off → on)');
  // "already on" reads as such, not as a verified action
  const already = cap('turn_on', st({ power: 'on' }), st({ power: 'on' }));
  assert.match(resultOf(already, verdict(already)), /^already on/);
  assert.match(summarize(caps), /1 verified, 4 sent without read-back/);
});
