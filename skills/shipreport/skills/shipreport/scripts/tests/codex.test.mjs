import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexSessions } from '../lib/sessions.mjs';

test('nested Codex rollouts produce citable digests without duplicate turns or raw secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  try {
    const dir = join(root, '2026', '09', '08');
    mkdirSync(dir, { recursive: true });
    const rows = [
      { type: 'session_meta', payload: { id: 'codex-test', cwd: '/home/example/project', git: { branch: 'dev' } } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix ghp_abcdefghijklmnopqrstuvwx' }] } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'duplicate' } },
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.apply_patch', input: 'private file content' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed' }] } },
    ].map((row, i) => ({ timestamp: `2026-09-08T12:00:0${i}Z`, ...row }));
    writeFileSync(join(dir, 'rollout-test.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
    writeFileSync(join(dir, 'invalid.jsonl'), 'not JSON');
    const result = indexSessions({ root });
    assert.equal(result.scanned, 2);
    assert.equal(result.skipped, 1);
    const [digest] = result.digests;
    assert.equal(digest.receipt, 'session:codex-test');
    assert.equal(digest.project, 'project');
    assert.equal(digest.userTurns, 1);
    assert.equal(digest.assistantTurns, 1);
    assert.equal(digest.edits, 1);
    assert.ok(!JSON.stringify(digest).includes('abcdefghijklmnopqrstuvwx'));
    assert.ok(!JSON.stringify(digest).includes('private file content'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
