import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readHouse } from '../lib/house.mjs';
import { ciEntry, validateConfig, readCiConfig } from '../lib/ci-config.mjs';
import { planScaffold } from '../lib/scaffold.mjs';
import { applyPlan } from '../lib/apply.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const spec = {name:'fixture-new',description:'Fixture',stack:'node',npmPublish:true,version:'0.1.0',author:'Fixture',summary:'Count things.',oneRule:'Read actual counts.',entrypoint:'fixture-new',what:'fixture',trigger:'fixture-new',does:'Count things.',output:'A count.',commands:[{name:'count',does:'count things'}],split:{deterministic:[{step:'count',command:'fixture-new count'}],nondeterministic:[{step:'explain',why:'needs context'}]},references:[{file:'anatomy.md',is:'the output'}],evalPlan:[{id:'real',kind:'golden',pinnedAgainst:'real data',catches:'wrong count'}]};
function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'skillfactory-config-'));t.after(() => rmSync(repo, {recursive:true,force:true}));
  for (const path of ['.github/skills-config.yml','.github/shipflow.json','.github/repo-settings.sh','.claude-plugin/marketplace.json','skills/press/skills/press/targets.json','README.md','CLAUDE.md','.github/workflows/ci.yml','.github/workflows/release-dispatch.yml']) {
    mkdirSync(dirname(join(repo,path)),{recursive:true}); cpSync(join(root,path),join(repo,path));
  }
  return repo;
}
test('config-enabled scaffolding appends a skill transactionally without creating a caller', t => {
  const repo=fixture(t), house=readHouse(repo);
  const plan=planScaffold(spec,house,{today:'2026-10-02',pins:{}});
  assert.equal(plan.files.some(f=>f.path.endsWith('.yml')),false);
  const result=applyPlan(repo,plan); assert.ok(result.some(r=>r.path==='.github/skills-config.yml'&&r.action==='wire'));
  const c=readCiConfig(repo); assert.deepEqual(c.skills[spec.name],ciEntry(spec));
  assert.ok(JSON.parse(readFileSync(join(repo,'.github/shipflow.json'))).release.components.includes(spec.name));
  assert.equal(existsSync(join(repo,'.github/workflows/fixture-new.yml')),false);
  assert.deepEqual(Object.keys(c.skills).sort(),[...Object.keys(house.ciConfig.skills),spec.name].sort());
});
test('a malformed present config cannot silently revert to caller scaffolding', t => {
  const repo=fixture(t);writeFileSync(join(repo,'.github/skills-config.yml'),'bad yaml');
  assert.throws(()=>readHouse(repo));
});
test('a dangling config symlink is a read error, never a legacy fallback', t => {
  const repo=fixture(t);rmSync(join(repo,'.github/skills-config.yml'));
  symlinkSync('missing-config',join(repo,'.github/skills-config.yml'));
  assert.throws(()=>readHouse(repo),/ENOENT/);
});
test('config edits fail before any scaffold files when existing entry collides', t => {
  const repo=fixture(t);const c=readCiConfig(repo);c.skills[spec.name]=ciEntry(spec);writeFileSync(join(repo,'.github/skills-config.yml'),JSON.stringify(c));
  const plan=planScaffold(spec,readHouse(repo),{today:'2026-10-02',pins:{}});
  assert.throws(()=>applyPlan(repo,plan),/already contains/);
  assert.equal(existsSync(join(repo,'skills/fixture-new')),false);
});
test('Python config defaults retain Python install/tests and common runtime lint support', () => {
  const c=ciEntry({...spec,stack:'python',npmPublish:false});
  assert.equal(c.python,'3.12');assert.equal(c.node,'');assert.equal(c.release.npmPublish,false);
  assert.deepEqual(c.checks.slice(1).map(s=>s.run),['pip install -r requirements-dev.txt','python -m pytest']);
  validateConfig({schemaVersion:1,sharedPaths:['tools/**'],skills:{[spec.name]:c}});
});
