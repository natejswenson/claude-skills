/**
 * The house — every registry a skill has to be wired into, read from disk.
 *
 * Nothing here has an opinion. It reports what the repo actually says, so the
 * conformance rules in conform.mjs are checked against reality rather than
 * against a remembered convention. Reading these registries is also what makes
 * skillfactory's question budget achievable: a name collision, the required-check set
 * and the press target list are all facts, and a fact is never a question.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Parse ONLY a SKILL.md frontmatter block — never the body. Mirrors tools/score_skill.py. */
export function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return {};
  const out = {};
  for (const raw of lines.slice(1, end)) {
    const stripped = raw.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    if (!key) continue;
    let value = raw.slice(idx + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Every registry, read once.
 *
 * `skills` is the directory listing, which is the authority on what exists —
 * a skill can be missing from marketplace.json, and that absence is exactly the
 * kind of half-done wiring conform.mjs is looking for.
 */
export function readHouse(repo) {
  const skillsDir = join(repo, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
    : [];

  const marketplace = readJson(join(repo, '.claude-plugin', 'marketplace.json'));
  const settings = readText(join(repo, '.github', 'repo-settings.sh')) ?? '';
  const targetsFile = readJson(join(repo, 'skills', 'press', 'skills', 'press', 'targets.json'));

  // The required-check contexts array, as repo-settings.sh literally writes it.
  const contextsLine = settings.match(/"contexts"\s*:\s*\[([^\]]*)\]/);
  const contexts = contextsLine
    ? [...contextsLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];

  const workflowsDir = join(repo, '.github', 'workflows');
  const workflows = existsSync(workflowsDir) ? readdirSync(workflowsDir).sort() : [];

  return {
    repo,
    skills,
    marketplaceNames: (marketplace?.plugins ?? []).map((p) => p.name),
    marketplaceSources: Object.fromEntries((marketplace?.plugins ?? []).map((p) => [p.name, p.source])),
    contexts,
    workflows,
    pressTargets: targetsFile?.targets ?? [],
    hasPress: Boolean(targetsFile),
  };
}

/**
 * The action SHAs this repo already pins, read out of the callers it already
 * trusts. A generated workflow must never carry a SHA skillfactory remembered: a
 * frozen pin table starts rotting the day it ships, and a hallucinated one is
 * the exact defect ghfactory's rung 0 exists to catch. Reading the repo's own
 * choice is both current and consistent with every sibling workflow.
 *
 * Returns {"actions/checkout": "<sha> # v7.0.1", …} for the most common pin of
 * each action across the callers.
 */
export function readActionPins(repo) {
  const dir = join(repo, '.github', 'workflows');
  if (!existsSync(dir)) return {};
  const counts = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const text = readText(join(dir, file)) ?? '';
    for (const m of text.matchAll(/uses:\s*([\w.-]+\/[\w./-]+)@([0-9a-f]{40})(\s*#\s*\S+)?/g)) {
      const key = m[1];
      const pin = `${m[2]}${m[3] ? ` #${m[3].replace(/^\s*#/, '')}` : ''}`.trim();
      const bucket = counts.get(key) ?? new Map();
      bucket.set(pin, (bucket.get(pin) ?? 0) + 1);
      counts.set(key, bucket);
    }
  }
  const out = {};
  for (const [action, bucket] of counts) {
    out[action] = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

/** Everything one skill's own tree says about itself. */
export function readSkill(repo, name) {
  const root = join(repo, 'skills', name);
  const inner = join(root, 'skills', name);
  const skillMd = readText(join(inner, 'SKILL.md'));
  const pkg = readJson(join(inner, 'package.json'));
  const invariants = readJson(join(inner, 'skill-invariants.json'));
  const plugin = readJson(join(root, '.claude-plugin', 'plugin.json'));
  const fm = skillMd ? frontmatter(skillMd) : {};

  return {
    name,
    root,
    inner,
    exists: existsSync(inner),
    skillMd,
    frontmatter: fm,
    pkg,
    plugin,
    invariants,
    stack: pkg ? 'node' : 'python',
    version: plugin?.version ?? fm.version ?? pkg?.version ?? null,
    caller: readText(join(repo, '.github', 'workflows', `${name}.yml`)),
    readme: readText(join(root, 'README.md')),
    hasReadme: existsSync(join(root, 'README.md')),
    hasChangelog: existsSync(join(root, 'CHANGELOG.md')),
    hasLicense: existsSync(join(root, 'LICENSE')),
  };
}
