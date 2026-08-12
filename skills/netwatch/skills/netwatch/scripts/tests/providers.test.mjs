import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupProvider, ipInCidr } from '../lib/providers.mjs';

test('well-known blocks resolve to their operator', () => {
  assert.equal(lookupProvider('17.253.72.14').owner, 'Apple');
  assert.equal(lookupProvider('160.79.104.10').owner, 'Anthropic');
  assert.equal(lookupProvider('216.24.57.7').owner, 'Render');
  assert.equal(lookupProvider('35.190.46.17').owner, 'Google Cloud');
  assert.equal(lookupProvider('140.82.112.3').owner, 'GitHub');
});

test('private, loopback and link-local are named, not treated as remote', () => {
  assert.equal(lookupProvider('192.168.1.43').category, 'private');
  assert.equal(lookupProvider('127.0.0.1').category, 'local');
  assert.equal(lookupProvider('fe80:13::aa35:70b7:7318:8427').category, 'local');
  assert.equal(lookupProvider('::1').category, 'local');
});

test('an address in no known block is honestly unknown, never guessed', () => {
  const r = lookupProvider('203.0.113.9');
  assert.equal(r.owner, 'unknown network');
  assert.equal(r.category, 'unknown');
});

test('the lookup NEVER emits a safety word — it is ownership, not a verdict', () => {
  // The one rule as a property of this table: it may name an operator, but it
  // may never say a flow is dangerous/safe/malicious/suspicious.
  const banned = /danger|malic|suspic|threat|\bsafe\b|\bbad\b|trust/i;
  const samples = ['17.0.0.1', '8.8.8.8', '203.0.113.9', 'fe80::1', '::1', '10.1.2.3', '52.94.1.1'];
  for (const ip of samples) {
    const { owner, category } = lookupProvider(ip);
    assert.doesNotMatch(owner, banned, `owner for ${ip} leaked a verdict word`);
    assert.doesNotMatch(category, banned, `category for ${ip} leaked a verdict word`);
  }
});

test('CIDR membership is computed, not string-matched', () => {
  assert.ok(ipInCidr('216.24.57.7', '216.24.56.0/22'));   // .57 is inside .56/22
  assert.ok(!ipInCidr('216.24.60.1', '216.24.56.0/22'));  // .60 is outside
  assert.ok(ipInCidr('160.79.104.10', '160.79.104.0/23'));
  assert.ok(!ipInCidr('160.79.106.10', '160.79.104.0/23'));
  assert.ok(!ipInCidr('fe80::1', '216.24.56.0/22'));       // IPv6 never matches a v4 CIDR
  assert.ok(!ipInCidr('216.24.57.7', 'not-a-cidr'));
});
