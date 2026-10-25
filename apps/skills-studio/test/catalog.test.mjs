import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog } from '../server/catalog.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('every marketplace skill appears in its intended library category', async () => {
  const expected = {
    devlog: 'Create', ghostwriter: 'Create', 'ghostwriter-x': 'Create', resume: 'Create',
    'github-stats': 'Research', shipflow: 'Build', 'city-report': 'Research', press: 'Create',
    ghfactory: 'Build', skillfactory: 'Build', eval: 'Research', release: 'Build',
    pluginsync: 'Organize', issueflow: 'Build', shipreport: 'Research', gmailtriage: 'Organize',
    skillhelp: 'Research', brandreport: 'Research', netwatch: 'Organize', appletv: 'Organize',
    issuecreator: 'Build', 'bible-study': 'Research', traefik: 'Organize', 'local-dev': 'Build',
    dotfiles: 'Organize', 'brand-images': 'Create',
  };
  const catalog = await readCatalog(repoRoot);
  assert.ok(catalog.length >= 26, 'the real marketplace must be exercised');
  for (const skill of catalog) {
    assert.ok(Object.hasOwn(expected, skill.id), `${skill.id} needs an intentional category and starter`);
    assert.equal(skill.category, expected[skill.id], skill.id);
  }
  for (const id of Object.keys(expected)) {
    assert.ok(catalog.some(skill => skill.id === id), `${id} must remain discoverable`);
  }
});

test('every known skill offers an editable task instead of generic usage advice', async () => {
  for (const skill of await readCatalog(repoRoot)) {
    assert.ok(skill.example?.trim(), `${skill.id} needs a starter`);
    assert.doesNotMatch(skill.example, /Help me use .+ in my project\./i, skill.id);
  }
});

test('starters distinguish image generation, skill creation and workflow tasks', async () => {
  const catalog = new Map((await readCatalog(repoRoot)).map(skill => [skill.id, skill]));
  const tasks = {
    'brand-images': /(?:generate|create).*(?:image|illustration).*(?:style|brand)/i,
    skillfactory: /create.*skill.*(?:that|for).+/i,
    ghfactory: /(?:create|add|generate).*GitHub Actions.*(?:test|build|CI)/i,
    shipflow: /(?:plan|set up).*branch.*(?:workflow|protection)/i,
    eval: /(?:evaluate|grade).*run/i,
    release: /(?:review|release).*\[component\]/i,
    pluginsync: /(?:refresh|update).*marketplace/i,
    issueflow: /(?:work|implement).*\[issue URL\]/i,
    skillhelp: /(?:explain|how).*(?:configure|set up|use).*\[skill name\]/i,
    issuecreator: /(?:draft|create).*issue.*(?:that|for|about).+/i,
    traefik: /(?:check|inspect).*Traefik.*health/i,
    'local-dev': /(?:build|implement|fix).*(?:feature|bug).+/i,
    dotfiles: /check.*dotfile.*link/i,
  };
  for (const [id, task] of Object.entries(tasks)) assert.match(catalog.get(id).example, task, id);
});

test('a new skill without presentation metadata remains available without a fabricated task', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.claude-plugin'));
  await mkdir(join(root, 'skills', 'new-skill'), { recursive: true });
  await writeFile(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    plugins: [{ name: 'new-skill', source: '.' }],
  }));
  await writeFile(join(root, 'skills', 'new-skill', 'SKILL.md'), '---\nname: new-skill\ndescription: A newly installed skill.\n---\n');
  const catalog = await readCatalog(root);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].available, true);
  assert.equal(catalog[0].category, 'Other');
  assert.ok(!catalog[0].example, 'unknown capabilities must not be invented');
});
