import { CodexClient, requireSubscription } from '../server/codex.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const client = new CodexClient();
try {
  await client.initialize();
  const { account } = await client.request('account/read');
  requireSubscription(account);
  console.log('PASS: ChatGPT subscription authentication');
  const { data: models } = await client.request('model/list', { limit: 100 });
  const model = models.find(m => m.isDefault) || models[0];
  console.log('PASS: model discovery', model?.model);
  const workspace = await mkdtemp(join(tmpdir(), 'skills-studio-proof-'));
  const skillDir = join(workspace, '.agents/skills/studio-proof');
  await mkdir(skillDir, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: studio-proof\ndescription: Validate Skills Studio integration.\n---\nWhen invoked, respond with STUDIO_SKILL_OK. Do not call tools.\n');
  const skills = await client.request('skills/list', { cwds: [workspace], forceReload: true });
  if (!skills.data.some(group => group.skills.some(s => s.name === 'studio-proof'))) throw new Error('Skill discovery failed.');
  console.log('PASS: workspace skill discovery');
  const { thread } = await client.request('thread/start', { cwd: workspace, model: model.model, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', serviceName: 'skills-studio-proof' });
  let text = '';
  const completed = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('event', onEvent); reject(new Error('Turn timed out.')); }, 120000);
    const onEvent = event => {
      if (event.params?.threadId !== thread.id) return;
      if (event.method === 'item/agentMessage/delta') text += event.params.delta;
      if (event.id !== undefined) client.reject(event.id, 'Proof does not authorize tool execution.');
      if (event.method === 'turn/completed') { clearTimeout(timer); client.off('event', onEvent); resolve(event.params.turn); }
    };
    client.on('event', onEvent);
  });
  let done = completed();
  await client.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: '$studio-proof' }, { type: 'skill', name: 'studio-proof', path: join(skillDir, 'SKILL.md') }], effort: 'low' });
  let turn = await done;
  if (turn.status !== 'completed' || !text.includes('STUDIO_SKILL_OK')) throw new Error(`Skill turn failed: ${turn.status} ${text}`);
  console.log('PASS: real skill invocation and streamed subscription response');
  text = '';
  done = completed();
  await client.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Reply with FOLLOWUP_OK only. No tools.' }], effort: 'low' });
  turn = await done;
  if (turn.status !== 'completed' || !text.includes('FOLLOWUP_OK')) throw new Error('Follow-up failed.');
  console.log('PASS: follow-up in the same conversation');
  done = completed();
  const active = await client.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Write a detailed 2000-word explanation of typography. Do not call tools.' }], effort: 'low' });
  await client.request('turn/interrupt', { threadId: thread.id, turnId: active.turn.id });
  turn = await done;
  if (turn.status !== 'interrupted') throw new Error(`Cancellation failed: ${turn.status}`);
  console.log('PASS: live cancellation ends the turn as interrupted');
  client.close();
  const reconnected = new CodexClient();
  try {
    await reconnected.initialize();
    requireSubscription((await reconnected.request('account/read')).account);
    const resumed = await reconnected.request('thread/resume', { threadId: thread.id });
    if (resumed.thread.id !== thread.id) throw new Error('Session recovery failed.');
    console.log('PASS: session resume from a new app-server process');
  } finally { reconnected.close(); }
} finally { client.close(); }
