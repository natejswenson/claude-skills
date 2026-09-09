/**
 * Host-specific dispatch profiles.
 *
 * The workflow stores the resolved model on each stage so a run cannot change
 * models halfway through because the orchestrator changed hosts. Review-loop
 * workers are resolved from the run's persisted runtime for the same reason.
 * Runs created before runtime support are Claude runs by construction.
 */
export const RUNTIMES = ['claude', 'codex'];

export function runtimeOf(run) {
  return RUNTIMES.includes(run?.runtime) ? run.runtime : 'claude';
}

export function assertRuntime(value) {
  const runtime = value ?? 'claude';
  if (!RUNTIMES.includes(runtime)) {
    throw new Error(`unknown runtime \`${runtime}\` — expected one of: ${RUNTIMES.join(', ')}`);
  }
  return runtime;
}

const CLAUDE = {
  investigate: { model: 'opus', agent: 'general-purpose' },
  implement: { model: 'opus', agent: 'general-purpose' },
  redTeam: { model: 'opus', agent: 'general-purpose' },
  finder: { model: 'opus', agent: 'general-purpose' },
  verifier: { model: 'opus', agent: 'general-purpose' },
  fixer: { model: 'sonnet', agent: 'general-purpose' },
  fixerEscalated: { model: 'opus', agent: 'general-purpose' },
};

// Astra carries the decisions and verification. Terra handles the parallel,
// read-heavy finder fleet and the first bounded fix; a surviving major moves
// the fixer to Astra at xhigh instead of repeating the cheaper attempt.
const CODEX = {
  // Planning is independently red-teamed by Astra before it can approve
  // itself, so the exploratory pass can use the faster balanced model.
  investigate: { model: 'gpt-5.6-terra', reasoning: 'high', agent: 'explorer' },
  implement: { model: 'gpt-6-astra', reasoning: 'high', agent: 'worker' },
  redTeam: { model: 'gpt-6-astra', reasoning: 'high', agent: 'explorer' },
  finder: { model: 'gpt-5.6-terra', reasoning: 'high', agent: 'explorer' },
  verifier: { model: 'gpt-6-astra', reasoning: 'high', agent: 'default' },
  fixer: { model: 'gpt-5.6-terra', reasoning: 'high', agent: 'worker' },
  fixerEscalated: { model: 'gpt-6-astra', reasoning: 'xhigh', agent: 'worker' },
};

export function dispatchProfile(runtime, role) {
  const profiles = assertRuntime(runtime) === 'codex' ? CODEX : CLAUDE;
  const profile = profiles[role];
  if (!profile) throw new Error(`no dispatch profile for ${runtime}/${role}`);
  return { ...profile };
}

export const dispatchLabel = (item, { compact = false } = {}) => {
  if (compact) {
    return item.reasoning ? `${item.model}; reasoning_effort=${item.reasoning}; role=${item.agent}` : item.model;
  }
  return item.reasoning
    ? `model \`${item.model}\`, reasoning_effort \`${item.reasoning}\`, role \`${item.agent}\``
    : `model \`${item.model}\``;
};
