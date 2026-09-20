/** Optional host hook. Inject the connected tool; never reads résumé/source files. */
export async function recallPresentation({ enabled = false, subject, tool, current = {} } = {}) {
  const preferences = { ...current };
  if (enabled !== true || typeof subject !== 'string' || !subject.trim() || typeof tool !== 'function') return preferences;
  const base = { contract: 'skill-memory-v1', skill: 'resume', subject };
  const keys = ['resume.presentation-format', 'resume.explanation-depth'];
  try {
    if ((await tool({ ...base, op: 'status' }))?.status !== 'ready') return preferences;
    const result = await tool({ ...base, op: 'recall', keys, max_context_bytes: 2048 });
    if (result?.status !== 'ok' || !Array.isArray(result.records) || !Array.isArray(result.conflict_keys)) return preferences;
    for (const key of keys) {
      if (Object.hasOwn(current, key) || result.conflict_keys.includes(key)) continue;
      const matches = result.records.filter(record => record?.key === key);
      if (matches.length !== 1) continue;
      const value = matches[0].value;
      const valid = key === 'resume.explanation-depth'
        ? ['brief', 'standard', 'detailed'].includes(value)
        : typeof value === 'string' && [...value].length <= 128;
      if (valid) preferences[key] = value;
    }
  } catch { /* Optional memory cannot block the original source-driven workflow. */ }
  return preferences;
}
