/**
 * The README house style, checked against the READMEs this repo actually ships.
 *
 * Pinned to a real corpus rather than a fixture for the same reason press lints
 * its own stylesheets: a contract strict enough to reject work already
 * published should fail here, in the change that tightened it, rather than in
 * someone's release.
 *
 * Two-sided throughout. Every mutation below is one a reviewer would plausibly
 * wave through, and each asserts the *specific* check that exists for it fired
 * — "it failed somewhere" would still pass if the six checks collapsed into one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readHouse } from '../lib/house.mjs';
import { gradeReadme, HEAD, FOOT } from '../lib/readme.mjs';
import { planScaffold } from '../lib/scaffold.mjs';
import { readme } from '../lib/templates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..', '..');

/**
 * The floor is anti-vacuity, not a target. The corpus is resolved by walking up
 * six directories from a nested skill dir; one wrong `..` matches nothing, and
 * every assertion below would then iterate an empty list and report every
 * README as conforming.
 */
const MIN_CORPUS = 20;

const readmeOf = (name) => readFileSync(join(REPO, 'skills', name, 'README.md'), 'utf8');

test('the corpus is real', () => {
  const { skills } = readHouse(REPO);
  assert.ok(
    skills.length >= MIN_CORPUS,
    `found ${skills.length} skills, floor is ${MIN_CORPUS} — the resolver is matching nothing, not the repo shrinking`,
  );
});

test('every shipped README satisfies the house style', () => {
  const { skills } = readHouse(REPO);
  assert.ok(skills.length >= MIN_CORPUS, `only ${skills.length} READMEs to check`);
  const failures = [];
  for (const name of skills) {
    const grade = gradeReadme(readmeOf(name), name);
    if (!grade.ok) failures.push(`${name}: ${grade.problems.map((p) => `${p.id} (${p.detail})`).join('; ')}`);
  }
  assert.deepEqual(failures, [], `README house style regressed:\n  ${failures.join('\n  ')}`);
});

// --- the negative side ----------------------------------------------------
//
// One real README, mutated six ways. `ghfactory` is the reference because it is the
// shortest conforming one, so a mutation is unambiguous rather than lost in a
// long tail.

const REFERENCE = 'ghfactory';
const ids = (text, name = REFERENCE) => gradeReadme(text, name).problems.map((p) => p.id);

test('a decorated H1 is caught — it silently detaches the press anchor', () => {
  const mutated = readmeOf(REFERENCE).replace(/^# ghfactory$/m, '# ghfactory (Claude Code skill)');
  assert.ok(ids(mutated).includes('h1'), 'the exact-match H1 check did not fire');
});

test('a deleted masthead is caught — a brand region can go missing silently', () => {
  const mutated = readmeOf(REFERENCE)
    .split('\n')
    .filter((l) => !l.includes('press:masthead'))
    .join('\n');
  assert.ok(ids(mutated).includes('masthead'), 'a README with no brand region graded clean');
});

test('an inventory written as prose is caught', () => {
  const text = readmeOf(REFERENCE).split('\n');
  const at = text.findIndex((l) => l === '## What you get');
  const next = text.findIndex((l, i) => i > at && /^## /.test(l));
  const mutated = [...text.slice(0, at + 1), '', 'Scripts, references and the invariants file.', '', ...text.slice(next)].join('\n');
  assert.ok(ids(mutated).includes('inventory-table'), 'a table-less inventory graded clean');
});

test('a reordered head is caught, not just a missing one', () => {
  const text = readmeOf(REFERENCE);
  const mutated = text
    .replace(`## ${HEAD[0]}`, '@@FIRST@@')
    .replace(`## ${HEAD[1]}`, `## ${HEAD[0]}`)
    .replace('@@FIRST@@', `## ${HEAD[1]}`);
  assert.ok(ids(mutated).includes('head-order'), 'swapping two head sections graded clean');
});

test('a missing foot section is caught', () => {
  const mutated = readmeOf(REFERENCE).replace(`## ${FOOT[0]}\n`, '');
  assert.ok(ids(mutated).includes('foot-order'), `dropping ## ${FOOT[0]} graded clean`);
});

test('a Quick start with no command in it is caught', () => {
  const text = readmeOf(REFERENCE).split('\n');
  const at = text.findIndex((l) => l === '## Quick start');
  const next = text.findIndex((l, i) => i > at && /^## /.test(l));
  const mutated = [...text.slice(0, at + 1), '', 'Run the detect command, then the verify command.', '', ...text.slice(next)].join('\n');
  assert.ok(ids(mutated).includes('quickstart-block'), 'a Quick start describing commands instead of showing them graded clean');
});

test('a missing standfirst and pull quote are each caught', () => {
  const text = readmeOf(REFERENCE).split('\n');
  const withoutStand = text.filter((l) => !/^\*[^*].*\*$/.test(l)).join('\n');
  assert.ok(ids(withoutStand).includes('standfirst'), 'a README with no standfirst graded clean');
  const withoutRule = text.filter((l) => !/^> \*\*/.test(l)).join('\n');
  assert.ok(ids(withoutRule).includes('pull-quote'), 'a README stating no one rule graded clean');
});

/**
 * The masthead is generated, so its contents must never be what satisfies a
 * check about hand-written prose. Without this, a region that happened to
 * contain an italic line would stand in for the standfirst.
 */
test('the generated region cannot satisfy the contract on the author’s behalf', () => {
  const text = readmeOf(REFERENCE).split('\n');
  const start = text.findIndex((l) => l.includes('>>> press:masthead'));
  const smuggled = [...text.slice(0, start + 1), '*a standfirst smuggled into the region*', ...text.slice(start + 1)];
  const withoutStand = smuggled.filter((l, i) => !(i > start + 1 && /^\*[^*].*\*$/.test(l))).join('\n');
  assert.ok(ids(withoutStand).includes('standfirst'), 'a line inside the generated region stood in for the author’s');
});


const hostCommands = (name) => [
  ['dual-host-claude-marketplace', '/plugin marketplace add natejswenson/claude-skills'],
  ['dual-host-claude-install', `/plugin install ${name}@claude-skills`],
  ['dual-host-claude-invocation', `/${name}`],
  ['dual-host-codex-marketplace', 'codex plugin marketplace add "$PWD"'],
  ['dual-host-codex-install', `codex plugin add ${name}@claude-skills`],
  ['dual-host-codex-invocation', `$${name}`],
];

for (const [id, command] of hostCommands(REFERENCE)) {
  test(`${id}: removing the command is caught in a real README`, () => {
    const text = readmeOf(REFERENCE);
    assert.ok(text.includes(`\n${command}\n`), `reference lost ${command}`);
    assert.ok(gradeReadme(text, REFERENCE).ok, 'the original README must pass');
    const mutated = text.replace(`\n${command}\n`, '\n');
    assert.ok(ids(mutated).includes(id), `removing ${command} did not report ${id}`);
  });
}

for (const [label, id] of [
  ['Claude Code', 'dual-host-claude-setup'],
  ['Codex', 'dual-host-codex-setup'],
  ['Personal data', 'dual-host-personal-data'],
]) {
  for (const [mutation, replacement] of [['removed', ''], ['empty', `- **${label}:**`]]) {
    test(`${id}: the ${mutation} Gmail requirement is caught`, () => {
      const text = readmeOf('gmailtriage');
      const line = text.split('\n').find((l) => l.startsWith(`- **${label}:** `));
      assert.ok(line, `reference lost ${label}`);
      assert.ok(gradeReadme(text, 'gmailtriage').ok, 'the original README must pass');
      assert.ok(ids(text.replace(line, replacement), 'gmailtriage').includes(id), `${label} requirement graded clean`);
    });
  }
}

test('retained personal-data paths cannot silently disappear', () => {
  const text = readmeOf('ghostwriter');
  assert.ok(text.includes('~/.claude/ghostwriter/'));
  assert.ok(gradeReadme(text, 'ghostwriter').ok);
  assert.ok(ids(text.replaceAll('~/.claude/ghostwriter/', '~/.codex/ghostwriter/'), 'ghostwriter')
    .includes('dual-host-personal-data-path'), 'renaming the retained credential location graded clean');
});

test('a migration link is required alongside the host setup notes', () => {
  const text = readmeOf(REFERENCE);
  assert.ok(text.includes('../../docs/codex-migration.md'));
  assert.ok(ids(text.replaceAll('../../docs/codex-migration.md', 'other.md'))
    .includes('dual-host-migration'), 'removing the host migration guidance graded clean');
});

test('the Codex marketplace command names the checkout root', () => {
  const text = readmeOf(REFERENCE);
  assert.ok(ids(text.replace('codex plugin marketplace add "$PWD"', 'codex plugin marketplace add /tmp/unrelated-marketplace'))
    .includes('dual-host-codex-marketplace'), 'an unrelated marketplace satisfied the checkout-root command');
});

for (const [id, command] of hostCommands(REFERENCE).filter(([id]) => !id.endsWith('marketplace'))) {
  test(`${id}: another skill name cannot satisfy the check`, () => {
    const text = readmeOf(REFERENCE);
    const mutated = text.replace(`\n${command}\n`, `\n${command.replaceAll(REFERENCE, `${REFERENCE}-extra`)}\n`);
    assert.ok(ids(mutated).includes(id), `a prefix match satisfied ${id}`);
  });
}

for (const [label, replacement] of [['shell comment', '# $ghfactory'], ['HTML comment', '<!-- $ghfactory -->'], ['prose', '']]) {
  test(`a ${label} outside Quick start fences cannot satisfy invocation`, () => {
    const text = readmeOf(REFERENCE);
    const command = '$ghfactory';
    const mutated = text.replace(`\n${command}\n`, `\n${replacement}\n`)
      .replace('## Triggers', `${command}\n\n## Triggers`);
    assert.ok(ids(mutated).includes('dual-host-codex-invocation'), 'prose or a comment stood in for invocation');
  });
}

const demo = JSON.parse(readFileSync(join(HERE, '../../evals/inputs/demo.spec.json'), 'utf8'));
for (const [id, command] of hostCommands(demo.name)) {
  test(`the scaffold README emits ${id}`, () => {
    assert.ok(readme(demo, { marketplace: 'claude-skills' }).includes(`\n${command}\n`), `scaffold omitted ${command}`);
  });
}
for (const label of ['Claude Code', 'Codex', 'Personal data']) {
  test(`the scaffold README emits the ${label} requirement`, () => {
    assert.ok(readme(demo, { marketplace: 'claude-skills' }).includes(`- **${label}:** `), `scaffold omitted ${label} setup`);
  });
}

test('the scaffold README uses the target marketplace and durable migration guide', () => {
  const plan = planScaffold(demo, { ...readHouse(REPO), marketplaceName: 'other-repo' }, { today: '2026-08-01', pins: {} });
  const text = plan.files.find((file) => file.path === `skills/${demo.name}/README.md`).content;
  assert.ok(text.includes(`codex plugin add ${demo.name}@other-repo`), 'scaffold used this repository’s marketplace');
  assert.ok(text.includes('https://github.com/natejswenson/claude-skills/blob/main/docs/codex-migration.md'),
    'scaffold linked to a migration guide unavailable in the target repository');
});

test('the scaffold refuses to document a Codex install without a target marketplace', () => {
  assert.throws(() => readme(demo), /target marketplace name/, 'scaffold documented an unknown marketplace');
});
