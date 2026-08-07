/**
 * The 10-step checklist, as one pure function.
 *
 * `CLAUDE.md` documents adding a skill as ten manual steps. Every one of them is
 * mechanical and every one of them is invisible when skipped — `ci / shipflow`
 * sat un-required from the day it was introduced until someone happened to run
 * a drift audit, because step 5 was done by hand and half-done.
 *
 * `planScaffold` returns the whole change as data: files to create, and anchored
 * edits to the five registries a skill has to appear in. Nothing is written
 * here, so `--dry-run` and the byte-exact golden read the same plan the real run
 * applies.
 *
 * Anchored edits FAIL when their anchor is missing. They never silently skip:
 * a half-applied wiring is the exact failure mode this file exists to end.
 */
import { join } from 'node:path';
import * as T from './templates.mjs';

const file = (path, content) => ({ path, content });

/** The files a new skill's tree consists of. Deterministic — this is the golden. */
export function planFiles(spec, today) {
  const root = join('skills', spec.name);
  const inner = join(root, 'skills', spec.name);
  const files = [
    file(join(root, 'LICENSE'), T.license(today.slice(0, 4))),
    file(join(root, 'README.md'), T.readme(spec)),
    file(join(root, 'CHANGELOG.md'), T.changelog(spec, today)),
    file(join(root, '.claude-plugin', 'plugin.json'), T.pluginJson(spec)),
    file(join(inner, 'SKILL.md'), T.skillMd(spec)),
    file(join(inner, 'skill-invariants.json'), T.invariants(spec)),
    file(join(inner, 'package.json'), T.packageJson(spec)),
    file(join(inner, 'scripts', `${spec.name}.js`), T.cli(spec)),
    file(join(inner, 'scripts', 'tests', 'skill-contract.test.mjs'), T.contractTest(spec)),
    file(join(inner, 'scripts', 'tests', 'baseline.test.mjs'), T.baselineTestStub(spec)),
  ];
  for (const ref of spec.references) {
    files.push(file(join(inner, 'references', ref.file), T.referenceStub(spec, ref)));
  }
  return files;
}

const edit = (path, find, replace, why) => ({ path, find, replace, why });

/**
 * The registry edits. Each one is a place a skill is invisible if it is absent:
 * absent from the marketplace nobody can install it; absent from the contexts
 * array it gates nothing on main; absent from targets.json the brand drift gate
 * cannot see it.
 */
export function planEdits(spec, house) {
  const n = spec.name;
  const edits = [];

  // 1. The marketplace manifest — structured, because it is pure JSON.
  edits.push({
    path: '.claude-plugin/marketplace.json',
    json: (data) => {
      if (data.plugins.some((p) => p.name === n)) return null;
      data.plugins.push({ name: n, source: `./skills/${n}` });
      return data;
    },
    why: 'without an entry the plugin cannot be installed, and lint_marketplace.py fails the PR',
  });

  // 2. The required-check context. Editing this applies NOTHING until an admin
  //    runs the script — the report says so, loudly.
  const lastContext = house.contexts[house.contexts.length - 1];
  edits.push(
    edit(
      '.github/repo-settings.sh',
      `"${lastContext}"]`,
      `"${lastContext}", "ci / ${n}"]`,
      'a caller that exists but is not required goes green on PRs and gates nothing',
    ),
  );

  // 3. press targets — the brand regions this skill will carry.
  edits.push({
    path: 'skills/press/skills/press/targets.json',
    json: (data) => {
      if (data.targets.some((t) => t.id === `${n}-agent-ui`)) return null;
      data.targets.push(
        {
          id: `${n}-agent-ui`,
          repo: 'claude-skills',
          path: `skills/${n}/skills/${n}/SKILL.md`,
          region: 'agent-ui',
          syntax: 'md',
          emitter: 'markdown-block',
          params: { doc: 'agent-ui' },
        },
        {
          id: `${n}-readme`,
          repo: 'claude-skills',
          path: `skills/${n}/README.md`,
          region: 'masthead',
          syntax: 'md',
          emitter: 'readme-masthead',
          params: {},
          init: { insertAfter: `^# ${n}$` },
        },
      );
      return data;
    },
    why: 'a consumer missing from targets.json is invisible to `press check`',
  });

  // 4. The release components. A skill absent from here is invisible to the
  //    `release` skill entirely — `preflight` reports on every OTHER component
  //    and looks complete — and `ci / release`'s corpus baseline fails the PR.
  //    Kept sorted, because the committed list is sorted and a diff that also
  //    reorders is a diff nobody reads.
  edits.push({
    path: '.github/shipflow.json',
    json: (data) => {
      const components = data.release?.components;
      if (!Array.isArray(components) || components.includes(n)) return null;
      components.push(n);
      components.sort();
      return data;
    },
    why: 'a component missing from release.components cannot be released, and ci / release fails the PR',
  });

  // 5-7. The three human-readable registries. Anchored on the last existing
  //      skill so a new one always lands at the end of the list it belongs to.
  const prev = house.marketplaceNames[house.marketplaceNames.length - 1];
  edits.push(
    edit(
      'README.md',
      `/plugin install ${prev}@claude-skills\n`,
      `/plugin install ${prev}@claude-skills\n/plugin install ${n}@claude-skills\n`,
      'the install block is the first thing a reader copies',
    ),
  );
  edits.push(
    edit(
      'README.md',
      `~/.claude/skills/${prev}\n`,
      `~/.claude/skills/${prev}\nln -sfn "$PWD/skills/${n}/skills/${n}" ~/.claude/skills/${n}\n`,
      'the symlink fallback has to list every skill or it silently omits one',
    ),
  );
  edits.push({
    path: 'README.md',
    appendTableRow: {
      after: /^\| \[`[^`]+`\]\(skills\/[^)]+\).*\|$/gm,
      row: `| [\`${n}\`](skills/${n}) | ![${n}](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=${n}-v*&label=&sort=semver&color=blue) | \`/${n}\` | ${spec.stack === 'node' ? 'Node' : 'Python'} | ${spec.summary} |`,
    },
    why: 'the skill table is the README',
  });

  // Anchored on the last context the settings script actually declares, not on
  // a remembered skill name — the two lists have to stay identical, and reading
  // one to edit the other is what keeps them that way.
  edits.push(
    edit(
      'CLAUDE.md',
      `\`${lastContext}\`.`,
      `\`${lastContext}\`, \`ci / ${n}\`.`,
      'the required-check list in CLAUDE.md is what the drift audit is read against',
    ),
  );

  return edits;
}

export function planScaffold(spec, house, { today, pins }) {
  return {
    files: [...planFiles(spec, today), file(join('.github', 'workflows', `${spec.name}.yml`), T.caller(spec, pins))],
    edits: planEdits(spec, house),
  };
}
