/**
 * Conformance — is this skill actually wired into the house, or only half of it?
 *
 * Two tiers, deliberately.
 *
 *   house    every skill in this repo satisfies it today. These are the checks
 *            whose failure means a skill is invisible somewhere: absent from the
 *            marketplace, gating nothing on main, or shipping no baseline.
 *   smith    additionally required of skills smith created. The existing skills
 *            predate the contract and are NOT retrofitted — a rule applied
 *            retroactively to shipped work is a rule that gets waived.
 *   advisory reported, never fatal. `github-stats`, `press` and `shipflow` ship
 *            with no press target, so demanding one would make a lie of the
 *            house tier on day one.
 *
 * The tiers exist so `verify` can be run against forge or devlog and be right
 * about them, which is the only reason to trust it about a skill it just made.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A skill is smith-native when its invariants say so. Claiming it opts into the stricter tier. */
export const isSmithNative = (skill) => Boolean(skill.invariants?.smith);

/** Minimum description length smith enforces on skills it creates. */
export const DESCRIPTION_FLOOR = 120;

/**
 * `score_skill.py` accepts 20 characters. That floor is the wrong tool for a NEW
 * skill: description is the only text Claude Code matches a user's request
 * against, so a terse one is not a style problem, it is a skill that never
 * triggers. smith demands a description that names concrete trigger phrases.
 */
export function gradeDescription(description) {
  const text = description ?? '';
  const triggers = [...text.matchAll(/"[^"]{3,}"/g)].length;
  return {
    length: text.length,
    triggers,
    ok: text.length >= DESCRIPTION_FLOOR && triggers >= 2,
    why:
      text.length < DESCRIPTION_FLOOR
        ? `description is ${text.length} chars, floor is ${DESCRIPTION_FLOOR} — too thin to match a real request`
        : triggers < 2
          ? 'description names fewer than 2 quoted trigger phrases — nothing for the matcher to hit'
          : null,
  };
}

const check = (id, level, ok, detail, fix) => ({ id, level, ok, detail, fix });

/** Every version field that is actually present, as {source: value}. */
export function versionFields(skill) {
  const fields = {};
  if (skill.plugin?.version) fields['plugin.json'] = skill.plugin.version;
  if (skill.frontmatter?.version) fields['SKILL.md'] = skill.frontmatter.version;
  if (skill.pkg?.version) fields['package.json'] = skill.pkg.version;
  return fields;
}

/**
 * Grade one skill. Returns a flat list of checks; the caller decides which
 * levels are fatal. Never throws on a missing file — an absent skill is a
 * finding, not an exception.
 */
export function conform(house, skill) {
  const name = skill.name;
  const out = [];
  const native = isSmithNative(skill);

  out.push(
    check(
      'skill-md',
      'house',
      Boolean(skill.skillMd),
      skill.skillMd ? `skills/${name}/skills/${name}/SKILL.md` : 'no SKILL.md at the nested path',
      'Claude Code plugin discovery only scans skills/<subdir>/SKILL.md — a root-level SKILL.md is invisible',
    ),
  );

  out.push(
    check(
      'frontmatter-name',
      'house',
      skill.frontmatter?.name === name,
      skill.frontmatter?.name ? `name: ${skill.frontmatter.name}` : 'no name: in frontmatter',
      `frontmatter name:, the directory, and plugin.json name must all be "${name}"`,
    ),
  );

  const desc = gradeDescription(skill.frontmatter?.description);
  out.push(
    check(
      'description',
      'house',
      desc.length >= 20 && desc.length <= 1024,
      `${desc.length} chars, ${desc.triggers} quoted triggers`,
      'score_skill.py requires [20, 1024]',
    ),
  );
  out.push(
    check(
      'description-strength',
      native ? 'smith' : 'advisory',
      desc.ok,
      desc.why ?? 'names concrete trigger phrases',
      `description is the only text a user's request is matched against — ${DESCRIPTION_FLOOR}+ chars, 2+ quoted phrases`,
    ),
  );

  out.push(
    check(
      'plugin-json',
      'house',
      skill.plugin?.name === name,
      skill.plugin ? `name: ${skill.plugin.name}` : 'missing .claude-plugin/plugin.json',
      'plugin.json name is sourced from the directory, NEVER from package.json name',
    ),
  );

  const versions = Object.values(versionFields(skill));
  out.push(
    check(
      'version-lockstep',
      'house',
      versions.length > 0 && versions.every((v) => v === versions[0]),
      Object.entries(versionFields(skill))
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
      'every present version field must be mutually equal — lint_plugin.py fails the PR otherwise',
    ),
  );

  out.push(
    check(
      'marketplace-entry',
      'house',
      house.marketplaceSources[name] === `./skills/${name}`,
      house.marketplaceSources[name] ?? 'absent from .claude-plugin/marketplace.json',
      `add {"name": "${name}", "source": "./skills/${name}"} to marketplace.json`,
    ),
  );

  const jobName = `ci / ${name}`;
  out.push(
    check(
      'caller-workflow',
      'house',
      Boolean(skill.caller) && skill.caller.includes(`name: ${jobName}`),
      skill.caller ? `.github/workflows/${name}.yml declares "${jobName}"` : `no .github/workflows/${name}.yml`,
      'the job name IS the required-check context — renaming it silently un-requires the check',
    ),
  );

  out.push(
    check(
      'required-check',
      'house',
      house.contexts.includes(jobName),
      house.contexts.includes(jobName) ? `"${jobName}" in repo-settings.sh contexts` : `"${jobName}" gates nothing on main`,
      'add it to .github/repo-settings.sh AND run the script — editing alone applies nothing',
    ),
  );

  const prose = skill.invariants?.prose ?? [];
  const baseline = skill.invariants?.baseline ?? [];
  out.push(
    check(
      'invariants',
      'house',
      prose.length > 0 && baseline.length > 0,
      skill.invariants ? `${prose.length} prose, ${baseline.length} baseline` : 'no skill-invariants.json',
      'lint_baseline.py fails the PR without a non-empty prose AND baseline block',
    ),
  );

  out.push(
    check(
      'plugin-root-docs',
      'house',
      skill.hasReadme && skill.hasChangelog && skill.hasLicense,
      [skill.hasReadme ? null : 'README.md', skill.hasChangelog ? null : 'CHANGELOG.md', skill.hasLicense ? null : 'LICENSE']
        .filter(Boolean)
        .join(', ') || 'README.md, CHANGELOG.md, LICENSE',
      'a release cuts notes from CHANGELOG.md — without it the GitHub Release ships empty',
    ),
  );

  // ---- smith tier: only asserted against skills that claim it ----------------

  const split = skill.invariants?.split;
  const det = split?.deterministic ?? [];
  const non = split?.nondeterministic ?? [];
  out.push(
    check(
      'split-declared',
      native ? 'smith' : 'advisory',
      det.length > 0 && non.length > 0,
      split ? `${det.length} deterministic, ${non.length} model-judgment` : 'no split block in skill-invariants.json',
      'every step belongs to exactly one half; an undeclared split is a skill nobody can reason about',
    ),
  );

  const unreal = det.filter((entry) => {
    const file = String(entry.command ?? '').match(/scripts\/[\w./-]+/)?.[0];
    return !file || !existsSync(join(skill.inner, file));
  });
  out.push(
    check(
      'split-commands-real',
      native ? 'smith' : 'advisory',
      det.length > 0 && unreal.length === 0,
      unreal.length ? `${unreal.length} deterministic step(s) name no real script` : `${det.length} commands resolve`,
      'a deterministic step whose command does not exist is prose pretending to be code',
    ),
  );

  const strayCode = ['bin', 'lib', 'src'].filter((d) => existsSync(join(skill.inner, d)));
  out.push(
    check(
      'one-code-dir',
      native ? 'smith' : 'advisory',
      strayCode.length === 0 && existsSync(join(skill.inner, 'scripts')),
      strayCode.length ? `code also at ${strayCode.map((d) => `${d}/`).join(', ')}` : 'all code under scripts/',
      'markdown at the root, one code directory below it — the skill should read, not scroll',
    ),
  );

  out.push(
    check(
      'press-region',
      native ? 'smith' : 'advisory',
      Boolean(skill.skillMd?.includes('press:agent-ui')),
      skill.skillMd?.includes('press:agent-ui') ? 'agent-ui region present' : 'SKILL.md carries no press:agent-ui region',
      'the run-presentation contract is spliced from press, never copied — copies drift silently',
    ),
  );

  const targets = house.pressTargets.filter((t) => String(t.path ?? '').startsWith(`skills/${name}/`));
  out.push(
    check(
      'press-target',
      native ? 'smith' : 'advisory',
      targets.length > 0,
      targets.length ? targets.map((t) => t.id).join(', ') : 'no press target — `press check` cannot see this skill',
      'a consumer missing from targets.json is invisible to the drift gate',
    ),
  );

  return out;
}

/** Fatal levels for a given skill: house always, smith only when claimed. */
export function fatalLevels(skill) {
  return isSmithNative(skill) ? ['house', 'smith'] : ['house'];
}

export function summarize(skill, checks) {
  const fatal = fatalLevels(skill);
  const failed = checks.filter((c) => !c.ok && fatal.includes(c.level));
  return { ok: failed.length === 0, failed, advisories: checks.filter((c) => !c.ok && !fatal.includes(c.level)) };
}
