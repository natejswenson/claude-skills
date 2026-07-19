// Pure, agent-drivable config mutations. Each function takes the current
// config object and returns a NEW validated config — the CLI layer owns
// reading/writing ~/.claude/skills/devlog/config.json atomically.
import { validateConfig, expandHome } from './core.mjs';

export function addProject(config, { key, path, remote, label, tagPrefix, pathFilter, private: isPrivate }) {
  if (config.projects.some((p) => p.key === key)) {
    throw new Error(`Project key "${key}" is already registered.`);
  }
  const project = { key, path: expandHome(path) };
  // remote is required unless the project is private (see core.mjs validateConfig).
  if (remote) project.remote = remote;
  if (isPrivate) project.private = true;
  if (label) project.label = label;
  // Only persist tagPrefix when it differs from the default `v` (keeps configs clean).
  if (tagPrefix && tagPrefix !== 'v') project.tagPrefix = tagPrefix;
  if (pathFilter) project.pathFilter = pathFilter;
  return validateConfig({ ...config, projects: [...config.projects, project] });
}

export function removeProject(config, key) {
  const projects = config.projects.filter((p) => p.key !== key);
  if (projects.length === config.projects.length) {
    throw new Error(`No project with key "${key}". Registered: ${config.projects.map((p) => p.key).join(', ') || '(none)'}`);
  }
  return validateConfig({ ...config, projects });
}

// Fields settable via `devlog set <field> <value>`. Everything funnels through
// validateConfig, so a bad value can never be persisted.
const SETTERS = {
  targetRepo: (c, v) => ({ ...c, targetRepo: v }),
  branch: (c, v) => ({ ...c, branch: v }),
  targetDir: (c, v) => (v === '' ? omit(c, 'targetDir') : { ...c, targetDir: v }),
  gitAuthor: (c, v) => ({ ...c, gitAuthor: v }),
  githubUser: (c, v) => ({ ...c, githubUser: v }),
  voicePath: (c, v) => (v === '' ? omit(c, 'voicePath') : { ...c, voicePath: expandHome(v) }),
  'deepDive.minSources': (c, v) => {
    const n = Number(v);
    return { ...c, deepDive: { ...(c.deepDive || {}), minSources: n } };
  },
  'deepDive.topicDomains': (c, v) => {
    const domains = v.split(',').map((t) => t.trim()).filter(Boolean);
    return { ...c, deepDive: { ...(c.deepDive || {}), topicDomains: domains } };
  },
};

export const SETTABLE_FIELDS = Object.keys(SETTERS);

export function setField(config, field, value) {
  const setter = SETTERS[field];
  if (!setter) {
    throw new Error(`Unknown field "${field}". Settable: ${SETTABLE_FIELDS.join(', ')}`);
  }
  if (typeof value !== 'string') throw new Error('Value must be a string.');
  return validateConfig(setter(config, value));
}

function omit(obj, key) {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
}
