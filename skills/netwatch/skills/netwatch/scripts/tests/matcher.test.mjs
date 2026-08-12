import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hostMatches, matchFlow, validateBaselineEntry } from '../netwatch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');

// The exact address the issue was filed against, reproduced from
// evals/baseline/capture.txt:51,66,73.
const RHOST = 'fe80:13::aa35:70b7:7318:8427';

test('the reporter\'s own keystroke now matches the reporter\'s flow', () => {
  assert.ok(hostMatches(RHOST, 'fe80:'), 'fe80: (1 hextet -> /16) must match');
});

test('fe80:: matches even though it is not a string prefix of RHOST', () => {
  // This is the assertion that proves the implementation is prefix
  // arithmetic and not startsWith: the scope id "13" sits between "fe80:"
  // and "::", so a naive `RHOST.startsWith('fe80::')` is false here. If this
  // line ever goes red, the matcher has regressed to string matching.
  assert.equal(RHOST.startsWith('fe80::'), false, 'sanity check on the trap itself');
  assert.ok(hostMatches(RHOST, 'fe80::'));
});

test('trailing-colon sugar narrows one hextet at a time, like trailing-dot for IPv4', () => {
  assert.ok(hostMatches(RHOST, 'fe80:13:'), 'fe80:13: (2 hextets -> /32) must match');
  assert.ok(!hostMatches('fe80:14::1', 'fe80:13:'), 'a different second hextet must not match');
});

test('IPv6 CIDR forms match the run\'s address, wrong ones do not', () => {
  assert.ok(hostMatches(RHOST, 'fe80::/10'));
  assert.ok(hostMatches(RHOST, 'fe80:13::/64'));
  assert.ok(!hostMatches(RHOST, '2606:4700::/32'));
});

test('one address, either spelling', () => {
  assert.ok(hostMatches('fe80::1', 'fe80:0:0:0:0:0:0:1/128'));
});

test('matching is case-insensitive, like the process check two lines away', () => {
  assert.ok(hostMatches(RHOST.toUpperCase(), 'fe80::/10'));
  assert.ok(hostMatches(RHOST, 'FE80::/10'));
});

test('a v4 host never matches a v6 pattern and vice versa', () => {
  assert.ok(!hostMatches('17.253.72.14', 'fe80::/10'));
  assert.ok(!hostMatches(RHOST, '17.253.'));
});

test('malformed IPv6 never half-matches', () => {
  assert.ok(!hostMatches('::ffff:1.2.3.4', 'fe80::/10'));
  assert.ok(!hostMatches('fe80:::1', 'fe80::/10'));
  assert.ok(!hostMatches('gggg::1', 'fe80::/10'));
  assert.ok(!hostMatches(RHOST, 'fe80::/129'));
});

test('a bare ":" or "::" pattern never matches, defense in depth beside the validator refusal', () => {
  assert.ok(!hostMatches(RHOST, ':'));
  assert.ok(!hostMatches(RHOST, '::'));
});

test('matchFlow finds the fe80: entry for the issue\'s flow', () => {
  const flow = { process: 'identityservicesd', rhost: RHOST, rport: '1024' };
  const entries = [{ host: 'fe80:', process: 'identityservicesd', note: 'Apple Continuity / Handoff over link-local' }];
  assert.equal(matchFlow(flow, entries), entries[0]);
});

test('the anti-vacuity floor extends to IPv6: ":" and "::" are refused, "fe80:" is not', () => {
  assert.ok(validateBaselineEntry({ host: ':' }, 0));
  assert.ok(validateBaselineEntry({ host: '::' }, 0));
  assert.equal(validateBaselineEntry({ host: 'fe80:' }, 0), null);
  assert.equal(validateBaselineEntry({ host: 'fe80::/10' }, 0), null);
});

test('the module is importable — no CLI runs and nothing prints on import', () => {
  // This is the mechanical reason hostMatches/matchFlow had zero direct unit
  // coverage before this change: importing scripts/netwatch.js used to run
  // main() at module scope and print the usage block.
  const out = execFileSync('node', ['-e', "import('./scripts/netwatch.js').then(() => process.exit(0))"], { cwd: SKILL, encoding: 'utf8' });
  assert.equal(out, '');
});
