import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSenderMetadata, normalizeGmailSearch, ingestSources, mergeThreadSources, applyCategories } from '../lib/ingest.mjs';
import { resolveSender } from '../lib/sender.mjs';

const header = 'Example Shop <offers@shop.example>';
const displayed = 'Example Shop offers@shop.example';
const search = (from_ = displayed, extra = {}) => ({ structuredContent: { emails: [{
  id: 'message-synthetic', thread_id: 'thread-synthetic', from_, subject: 'Invented offer',
  email_ts: '2026-10-01', labels: ['INBOX'], ...extra,
}] } });
const metadata = (extra = {}, headers = [{ name: 'From', value: header }]) => ({ structuredContent: {
  id: 'message-synthetic', thread_id: 'thread-synthetic', payload: { headers }, ...extra,
} });
const evidence = (...raw) => buildSenderMetadata({ schema: 1, paths: raw.map((_, i) => `${i}`) }, p => raw[Number(p)]);
const normalized = (raw, records) => normalizeGmailSearch(raw, 'synthetic', records)[0];

test('exact linked RFC metadata recovers only known connector serialization', () => {
  assert.equal(resolveSender(normalized(search())).ambiguous, true);
  const raw = search(); const before = JSON.stringify(raw);
  const recovered = normalized(raw, evidence(metadata()));
  assert.equal(recovered.from, header);
  assert.equal(resolveSender(recovered).address, 'offers@shop.example');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(resolveSender(normalized(search('arbitrary prefix offers@shop.example'), evidence(metadata()))).ambiguous, true);
});

test('wrong linkage, invalid headers and conflicting duplicate metadata cannot upgrade', () => {
  for (const record of [metadata({ id: 'other' }), metadata({ thread_id: 'other' }),
    metadata({}, []), metadata({}, [{ name: 'From', value: header }, { name: 'from', value: header }]),
    metadata({}, [{ name: 'From', value: 'malformed' }]), metadata({ payload: null }),
    { ...metadata(), isError: true }]) {
    assert.equal(resolveSender(normalized(search(), evidence(record))).ambiguous, true);
  }
  assert.equal(resolveSender(normalized(search(), evidence(metadata(), metadata({}, [{ name: 'From', value: 'Other <other@shop.example>' }])))).ambiguous, true);
  assert.equal(resolveSender(normalized(search(), evidence(metadata(), metadata()))).address, 'offers@shop.example');
});

test('valid original disagreement and existing markers withhold selection', () => {
  assert.equal(resolveSender(normalized(search('other@shop.example'), evidence(metadata()))).ambiguous, true);
  assert.equal(resolveSender(normalized(search('offers@shop.example'), evidence(metadata()))).address, 'offers@shop.example');
  assert.equal(resolveSender(normalized(search(displayed, { senderAmbiguous: false }), evidence(metadata()))).ambiguous, true);
});

test('overlapping sources preserve confidence or disagreement and leak no extra metadata', () => {
  const records = evidence(metadata({ snippet: 'PRIVATE-SNIPPET', extra: 'PRIVATE-EXTRA', payload: { headers: [
    { name: 'From', value: header }, { name: 'To', value: 'private@recipient.example' },
  ], body: 'PRIVATE-BODY' } }));
  const raw = search(displayed, { snippet: 'PRIVATE-SEARCH' });
  const same = mergeThreadSources(normalizeGmailSearch(raw, 'a', records), normalizeGmailSearch(raw, 'b', records));
  assert.equal(resolveSender(same[0]).address, 'offers@shop.example');
  assert.equal(resolveSender(mergeThreadSources(same, normalizeGmailSearch(search('other@shop.example'), 'c', records))[0]).ambiguous, true);
  const snapshot = applyCategories(same);
  assert.deepEqual(Object.keys(snapshot[0]).sort(), ['id', 'from', 'subject', 'date', 'labelIds', 'category', 'hasUnsubscribe'].sort());
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|recipient|message-synthetic|payload|headers/);
  const manifest = { schema: 1, sources: { inbox: { query: 'in:inbox', maxPages: 1, maxThreads: 10, pages: [{ pageToken: null, path: 'raw' }] } } };
  assert.equal(resolveSender(ingestSources(manifest, () => raw, {}, records).sources.inbox[0]).address, 'offers@shop.example');
  const plain = ingestSources(null, () => {}, { inbox: raw });
  const enriched = ingestSources(null, () => {}, { inbox: raw }, records);
  assert.deepEqual(enriched.coverage, plain.coverage);
  assert.equal(resolveSender(enriched.sources.inbox[0]).address, 'offers@shop.example');
  assert.equal(enriched.sources.promos.length, 0);
});

test('bare metadata and same-thread messages preserve linked sender constraints', () => {
  const records = evidence(metadata().structuredContent);
  assert.equal(resolveSender(normalized(search(), records)).address, 'offers@shop.example');
  const raw = search();
  raw.structuredContent.emails.push({ ...raw.structuredContent.emails[0], id: 'message-other', from_: 'other@shop.example' });
  assert.equal(resolveSender(normalized(raw, records)).ambiguous, true);
  assert.equal(resolveSender(normalized(search(null), records)).address, null);
});

test('metadata manifest rejects invalid shape with content-free errors', () => {
  for (const manifest of [null, {}, { schema: 1, paths: 'secret' }, { schema: 1, paths: [''] },
    { schema: 1, paths: [], secret: 'PRIVATE' }, { schema: 1, paths: [4] }]) {
    assert.throws(() => buildSenderMetadata(manifest, () => {}), /^Error: ingest: invalid sender metadata manifest$/);
  }
});

test('fresh CLI ingest loads metadata paths relative to their manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sender-metadata-'));
  try {
    const write = (p, value) => writeFileSync(join(dir, p), JSON.stringify(value));
    write('search.json', search()); write('labels.json', { labels: [] }); write('metadata.json', metadata());
    write('sender.json', { schema: 1, paths: ['metadata.json'] });
    const cli = fileURLToPath(new URL('../gmailtriage.js', import.meta.url));
    const run = (...flags) => spawnSync(process.execPath, [cli, 'ingest', '--inbox', join(dir, 'search.json'),
      '--labels', join(dir, 'labels.json'), '--out-threads', join(dir, 'threads.json'),
      '--out-labels', join(dir, 'out-labels.json'), '--out-coverage', join(dir, 'coverage.json'), ...flags], { encoding: 'utf8', cwd: dir });
    const result = run('--sender-metadata', join(dir, 'sender.json'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(resolveSender(JSON.parse(readFileSync(join(dir, 'threads.json'), 'utf8'))[0]).address, 'offers@shop.example');
    assert.equal(run('--sender-metadata').status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
