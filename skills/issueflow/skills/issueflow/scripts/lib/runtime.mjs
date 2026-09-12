/** Persisted host policy and the one adapter used by every dispatch path. */
import { randomUUID } from 'node:crypto';
export const RUNTIMES = ['claude', 'codex'];

// Four children drains the largest normal finder/verifier wave in two batches
// at most, while avoiding the serial behaviour of the old one-slot default.
export const DEFAULT_CODEX_CHILD_SLOTS = 4;

export function runtimeOf(run) {
  return assertRuntime(typeof run === 'string' ? run : run?.host ?? run?.runtime);
}

export function assertRuntime(value) {
  const runtime = value ?? 'claude';
  if (!RUNTIMES.includes(runtime)) throw new Error(`unknown runtime \`${runtime}\` — expected one of: ${RUNTIMES.join(', ')}`);
  return runtime;
}

export function dispatchPolicy(host, childSlots = assertRuntime(host) === 'codex' ? DEFAULT_CODEX_CHILD_SLOTS : 1) {
  if (!/^\d+$/.test(String(childSlots)) || !Number.isSafeInteger(Number(childSlots)) || Number(childSlots) < 1) {
    throw new Error('child-slots must be a positive integer');
  }
  return { host: assertRuntime(host), childSlots: Number(childSlots) };
}

export function setAvailableSlots(run, value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('available-child-slots must be a nonnegative host-observed integer');
  run.dispatch.availableChildSlots = Number(value);
  run.dispatch.capacitySource = 'host-observed';
}

export function effectiveSlots(run) {
  const configured = dispatchPolicy(runtimeOf(run), run.dispatch?.childSlots).childSlots;
  // Without host observation, a strict run starts conservatively with one
  // child. A configured maximum is not evidence that those slots are free.
  return Math.min(configured, run.dispatch?.availableChildSlots ?? (run.harness ? 1 : configured));
}

const ROLES = ['investigate', 'implement', 'redTeam', 'finder', 'verifier', 'fixer', 'fixerEscalated'];

/** Deterministic Codex effort selection; Claude never calls this policy. */
export function adaptiveReasoning(run, role, signals = {}) {
  let effort = ['finder', 'fixer'].includes(role) ? 'medium' : role === 'fixerEscalated' ? 'xhigh' : 'high';
  const risk = String(signals.risk ?? run?.reasoningPolicy?.risk ?? '').toLowerCase();
  const majors = Number(signals.unresolvedMajors ?? run?.reasoningPolicy?.unresolvedMajors ?? 0);
  const disagreement = Number(signals.disagreement ?? run?.reasoningPolicy?.disagreement ?? 0);
  if (risk === 'sensitive' || majors > 0 || disagreement > 0) effort = 'xhigh';
  else if (risk === 'low' && ['finder', 'verifier', 'fixer'].includes(role)) effort = 'medium';
  return effort;
}

export function dispatchProfile(run, role) {
  if (!ROLES.includes(role)) throw new Error(`no dispatch profile for ${runtimeOf(run)}/${role}`);
  if (runtimeOf(run) === 'claude') {
    // Review fanout uses the efficient model; core planning and implementation
    // retain Opus. This is the current shared Claude contract on dev.
    const model = ['finder', 'verifier', 'fixer'].includes(role) ? 'sonnet' : 'opus';
    return { model, agent: 'general-purpose' };
  }
  // Even readers write a result file. A read-only explorer cannot deliver it.
  // Read-heavy discovery and a first bounded fix do not need the parent-level
  // reasoning budget. A surviving major is the signal to pay for escalation.
  const reasoning = adaptiveReasoning(run, role, run?.reasoningPolicy ?? {});
  return { reasoning, agent: 'worker', fork_turns: 'none', taskRole: role };
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
  if (effectiveSlots(run) === 0) throw new Error('no available native child slots; observe releases before dispatch');
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

/** Return delivered queue entries and refill slots without crossing a wave barrier. */
export function rollingWave(run, delivered) {
  const queue = run.dispatch?.queue;
  if (!queue || queue.released) return [];
  const done = queue.active.filter(delivered);
  if (!done.length) return [];
  queue.active = queue.active.filter((item) => !delivered(item));
  const cap = effectiveSlots(run);
  const refill = queue.items.slice(queue.cursor, queue.cursor + Math.max(0, cap - queue.active.length));
  queue.cursor += refill.length;
  for (const item of refill) { item.dispatchedAt = Date.now(); item.attemptId = randomUUID(); }
  queue.active.push(...refill);
  return refill;
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
  const cap = effectiveSlots(run);
  if (cap === 0) throw new Error('no available native child slots; observe releases before dispatch');
  queue.active = queue.items.slice(queue.cursor, queue.cursor + cap);
  // Brief creation can precede this wave by many minutes.  Stalls measure the
  // actual dispatch, not when the complete fleet happened to be rendered.
  const dispatchedAt = Date.now();
  for (const item of queue.active) { item.dispatchedAt = dispatchedAt; item.attemptId = randomUUID(); }
  queue.cursor += queue.active.length;
  queue.released = false;
  return queue.active;
}
