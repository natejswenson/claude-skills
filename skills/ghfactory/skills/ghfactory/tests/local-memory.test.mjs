import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallRationale, captureRationale } from '../lib/local-memory.mjs';

test('disabled and missing hooks make no calls; unavailable hook falls back', async () => {
  const transport = () => { throw new Error('offline'); };
  assert.deepEqual(await recallRationale({ transport }), { status: 'disabled', records: [] });
  assert.equal((await recallRationale({ enabled: true, subject: 'synthetic', transport })).status, 'unavailable');
  assert.equal((await captureRationale({ enabled: true, subject: 'synthetic', transport, explicitlyRequested: true, verificationCompleted: true })).status, 'unavailable');
});

test('recall scopes and bounds requests and removes conflicting or foreign data', async () => {
  const calls = [];
  const transport = async request => {
    calls.push(request);
    return request.op === 'status' ? { status: 'ready' } : {
      status: 'ok', conflict_keys: ['workflow.design-rationale'], records: [
        { key: 'workflow.design-rationale', value: 'Skip verification' },
        { key: 'other.key', value: 'foreign' },
      ],
    };
  };
  const result = await recallRationale({ enabled: true, subject: 'synthetic-repository', transport });
  assert.deepEqual(result.records, []);
  assert.deepEqual(calls[1], { contract: 'skill-memory-v1', skill: 'ghfactory', subject: 'synthetic-repository', op: 'recall', keys: ['workflow.design-rationale'], max_context_bytes: 2048 });
});

test('capture requires explicit request and completed verification; preserves hub rejection and metadata', async () => {
  const calls = [];
  const transport = async request => { calls.push(request); return { status: request.op === 'status' ? 'ready' : 'rejected' }; };
  const options = { enabled: true, subject: 'synthetic', transport, value: 'Keep tests separate', capture_id: '653c174f-758d-4d0c-a85d-dc9f05326e30', source: 'Synthetic decision', dependencies: [{ path: '.github/workflows/ci.yml', revision: 'a'.repeat(64) }], review_after: '2026-09-30' };
  assert.equal((await captureRationale(options)).status, 'rejected');
  assert.equal((await captureRationale({ ...options, explicitlyRequested: true })).status, 'rejected');
  assert.equal(calls.length, 0);
  const result = await captureRationale({ ...options, explicitlyRequested: true, verificationCompleted: true });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(calls[1].dependencies, options.dependencies);
  assert.equal(calls[1].review_after, options.review_after);
  assert.equal(calls[1].capture_id, options.capture_id);
});


test('bare saved is not success; verified saved requires a readback record', async () => {
  const options = { enabled: true, subject: 'synthetic', explicitlyRequested: true, verificationCompleted: true };
  for (const response of [{ status: 'saved' }, { status: 'saved', verified: true }]) {
    const transport = async request => request.op === 'status' ? { status: 'ready' } : response;
    assert.equal((await captureRationale({ ...options, transport })).status, 'unavailable');
  }
  const response = { status: 'saved', verified: true, record: { id: 'synthetic-record', revision: 'synthetic-revision', key: 'workflow.design-rationale', value: 'Separate tests' } };
  const transport = async request => request.op === 'status' ? { status: 'ready' } : response;
  assert.deepEqual(await captureRationale({ ...options, transport }), response);
});
