/** Persisted host policy and the one adapter used by every dispatch path. */
export const RUNTIMES = ['claude', 'codex'];

export function runtimeOf(run) {
  return assertRuntime(typeof run === 'string' ? run : run?.host ?? run?.runtime);
}

export function assertRuntime(value) {
  const runtime = value ?? 'claude';
  if (!RUNTIMES.includes(runtime)) throw new Error(`unknown runtime \`${runtime}\` — expected one of: ${RUNTIMES.join(', ')}`);
  return runtime;
}

export function dispatchPolicy(host, childSlots = 1) {
  if (!/^\d+$/.test(String(childSlots)) || !Number.isSafeInteger(Number(childSlots)) || Number(childSlots) < 1) {
    throw new Error('child-slots must be a positive integer');
  }
  return { host: assertRuntime(host), childSlots: Number(childSlots) };
}

const ROLES = ['investigate', 'implement', 'redTeam', 'finder', 'verifier', 'fixer', 'fixerEscalated'];

export function dispatchProfile(run, role) {
  if (!ROLES.includes(role)) throw new Error(`no dispatch profile for ${runtimeOf(run)}/${role}`);
  if (runtimeOf(run) === 'claude') return { model: role === 'fixer' ? 'sonnet' : 'opus', agent: 'general-purpose' };
  // Even readers write a result file. A read-only explorer cannot deliver it.
  return { reasoning: role === 'fixerEscalated' ? 'xhigh' : 'high', agent: 'worker', fork_turns: 'none' };
}

export const modelLabel = (item) => item.model ?? 'parent model';

export const dispatchLabel = (item, { compact = false } = {}) => {
  if (item.fork_turns === 'none') {
    return compact
      ? `model override omitted; reasoning_effort=${item.reasoning}; role=${item.agent}; fork_turns=none`
      : `model override omitted (parent model), reasoning_effort \`${item.reasoning}\`, role \`${item.agent}\`, fork_turns \`none\``;
  }
  if (compact) return item.reasoning ? `${item.model}; reasoning_effort=${item.reasoning}; role=${item.agent}` : item.model;
  return item.reasoning
    ? `model \`${item.model}\`, reasoning_effort \`${item.reasoning}\`, role \`${item.agent}\``
    : `model \`${item.model}\``;
};

/** A queue contains every original brief once; output delivery never frees a slot. */
export function startWave(run, items) {
  if (runtimeOf(run) !== 'codex' || items.length === 0) return items;
  run.dispatch ??= dispatchPolicy('codex');
  if (run.dispatch.queue) throw new Error('an active wave must deliver and release its workers first');
  run.dispatch.queue = { items, cursor: 0, active: [], released: true };
  return advanceWave(run);
}

export function waveState(run, delivered) {
  const queue = run.dispatch?.queue;
  if (!queue) return null;
  if (queue.released) return { kind: 'ready', items: [] };
  const items = queue.active;
  return { kind: items.every(delivered) ? 'release' : 'wait', items };
}

export function releaseWave(run, delivered) {
  const queue = run.dispatch?.queue;
  // `next --workers-released` is retried after an infrastructure failure.
  // Its acknowledgement was already persisted before that failure, so making
  // the same acknowledgement a no-op is the only safe retry behaviour.
  if (!queue || queue.released) return false;
  if (!queue.active.every(delivered)) throw new Error('cannot release a wave before all its outputs have delivered');
  queue.released = true;
  if (queue.cursor === queue.items.length) delete run.dispatch.queue;
  return true;
}

export function advanceWave(run) {
  const queue = run.dispatch?.queue;
  if (!queue) return [];
  if (!queue.released) throw new Error('active workers must release their slots before the next wave');
  const cap = dispatchPolicy(runtimeOf(run), run.dispatch.childSlots).childSlots;
  queue.active = queue.items.slice(queue.cursor, queue.cursor + cap);
  // Brief creation can precede this wave by many minutes.  Stalls measure the
  // actual dispatch, not when the complete fleet happened to be rendered.
  const dispatchedAt = Date.now();
  for (const item of queue.active) item.dispatchedAt = dispatchedAt;
  queue.cursor += queue.active.length;
  queue.released = false;
  return queue.active;
}
