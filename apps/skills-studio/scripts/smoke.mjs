// Explicit live check: consumes the signed-in Codex subscription, never API billing.
const base = process.env.STUDIO_URL || 'http://127.0.0.1:4317';
async function api(path, body) {
  const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const state = await api('/api/bootstrap');
if (state.account?.type !== 'chatgpt' || state.connection.status !== 'connected') throw new Error('Subscription connection is not ready.');
const run = await api('/api/runs', { skillId: 'skillhelp', prompt: 'Explain briefly what the city-report skill does, grounded in the skill index. Save your answer as studio-proof.md in the current workspace. Do not publish anything or use external services.' });
console.log('Started real catalog skill run:', run.id);
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  const current = await api(`/api/runs/${run.id}`);
  if (current.pending.length) throw new Error('Live smoke needs an approval or answer; finish it in the UI.');
  if (['failed', 'stopped', 'interrupted'].includes(current.status)) throw new Error(current.error || current.status);
  if (current.status === 'completed' && current.artifacts.length) {
    const artifact = current.artifacts.find(a => a.name === 'studio-proof.md');
    if (!artifact) throw new Error('Expected report was not captured.');
    const output = await fetch(`${base}/api/runs/${run.id}/artifacts/${artifact.id}`);
    if (!output.ok || !(await output.text()).includes('city')) throw new Error('Output preview failed.');
    console.log('PASS: catalog skill → subscription turn → saved conversation → immutable artifact preview');
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (Date.now() >= deadline) throw new Error('Live smoke timed out.');
