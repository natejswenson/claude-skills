import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readStatus, prepare, cut, resolveReleaseTarget } from '../lib/release.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const put = (dir, file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text); };
const json = (dir, file, value) => put(dir, file, JSON.stringify(value, null, 2) + '\n');
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const py = (dir, ...args) => execFileSync('python3', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
function fixture(t, { dual = false, lock = true, legacy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'github-flow-release-'));
  const repo = join(dir, 'repo'); mkdirSync(repo);
  const remote = join(dir, 'origin.git'); git(dir, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  const config = { workflowPattern: legacy ? 'dev-main-promotion' : 'github-flow', branches: { main: 'main', dev: 'integration' }, requiredChecks: ['ci / alpha', 'ci / beta'], release: { components: ['alpha', 'beta'], componentLayout: {
    versionFiles: ['skills/{name}/skills/{name}/package.json', 'skills/{name}/skills/{name}/SKILL.md', 'skills/{name}/.claude-plugin/plugin.json', 'skills/{name}/skills/{name}/package-lock.json', ...(dual ? ['skills/{name}/.codex-plugin/plugin.json'] : [])],
    changelog: 'skills/{name}/CHANGELOG.md', tagPattern: '{name}-v{version}', paths: ['skills/{name}'], workflowFile: '{name}.yml',
  } } };
  json(repo, '.github/shipflow.json', config);
  json(repo, '.claude-plugin/marketplace.json', { name: 'fixture', plugins: ['alpha', 'beta'].map((name) => ({ name, source: `./skills/${name}` })) });
  for (const name of ['alpha', 'beta']) {
    json(repo, `skills/${name}/skills/${name}/package.json`, { name, version: '0.1.0' });
    put(repo, `skills/${name}/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Fixture\nversion: 0.1.0\n---\nFixture.\n`);
    json(repo, `skills/${name}/.claude-plugin/plugin.json`, { name, version: '0.1.0', description: 'Fixture', author: { name: 'Fixture' } });
    if (lock) json(repo, `skills/${name}/skills/${name}/package-lock.json`, { name, version: '0.1.0', lockfileVersion: 3, packages: { '': { name, version: '0.1.0' }, 'node_modules/dependency': { version: '8.7.6', integrity: 'sha512-fixture' } } });
    put(repo, `skills/${name}/CHANGELOG.md`, '# Changelog\n\n## [0.1.0] - 2026-01-01\n\n- Initial.\n');
    put(repo, `.github/workflows/${name}.yml`, `name: ${name}\non:\n  push:\n  pull_request:\n  workflow_dispatch:\njobs:\n  release:\n    if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'\n    uses: ./.github/workflows/_release.yml\n`);
  }
  if (dual) {
    for (const file of ['sync_codex.py', 'check_compatibility.py', 'lint_marketplace.py', 'lint_plugin.py', 'score_skill.py']) {
      mkdirSync(join(repo, 'tools'), { recursive: true }); cpSync(join(root, 'tools', file), join(repo, 'tools', file));
    }
    py(repo, 'tools/sync_codex.py');
  }
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'feat: initial'); git(repo, 'tag', 'alpha-v0.1.0');
  git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main', '--tags');
  if (legacy) { git(repo, 'branch', 'integration'); git(repo, 'push', 'origin', 'integration'); }
  t.after(() => { git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).filter((p) => p !== repo).forEach((p) => rmSync(p, { recursive: true, force: true })); rmSync(dir, { recursive: true, force: true }); });
  return { dir, repo, config, remote };
}
function fakeGh(t, f, mode = 'green') {
  const bin = join(f.dir, 'bin'); mkdirSync(bin);
  const stateFile = join(f.dir, 'state.json'); json(f.dir, 'state.json', { mode, calls: [], prs: [] });
  put(bin, 'gh', `#!/usr/bin/env node\n${String.raw`
const fs = require('node:fs'); const cp = require('node:child_process');
const file = process.env.FAKE_GH_STATE; const s = JSON.parse(fs.readFileSync(file)); const a = process.argv.slice(2); s.calls.push(a);
const repo = process.env.FAKE_GH_REPO; const git = (...args) => cp.execFileSync('git', args, {cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const arg = (flag) => a[a.indexOf(flag)+1];
const save = (value) => { fs.writeFileSync(file, JSON.stringify(s)); console.log(JSON.stringify(value)); };
if(a[0] === 'api') {
 const p = a[1];
 if(p.includes('/pulls?')) { const u = new URL('https://fixture/' + p); const head = u.searchParams.get('head').split(':').at(-1); const base = u.searchParams.get('base'); save(s.prs.filter(r=>!r.merged && r.head.ref===head && r.base.ref===base)); }
 else if(/\/pulls\/\d+$/.test(p)) { const pr = s.prs.find(r=>r.number===Number(p.split('/').at(-1))); if(pr && pr.head.ref==='integration') { git('push', 'origin', 'integration:main'); pr.merged=true; } save(pr); }
 else if(p.endsWith('/protection')) save({required_status_checks:{contexts:['ci / alpha', 'ci / beta']}});
 else if(p.includes('/rules/branches/')) save([{type:'required_status_checks',parameters:{required_status_checks:[{context:'ci / rules'}]}}]);
 else if(p.includes('/check-runs')) save({check_runs:(s.mode==='missing'?['ci / alpha']:['ci / alpha','ci / beta','ci / rules']).map(name=>({name,status:'completed',conclusion:s.mode==='failed' && name==='ci / beta'?'failure':'success'}))});
 else if(p.endsWith('/status')) save({statuses:[]});
 else if(p.includes('/releases/tags/')) save({html_url:'https://example.invalid/release',body:'- Requested notes.'});
 else if(p.includes('/labels/')) save({});
 else {save({error:'unexpected api',p});process.exit(1);}
} else if(a[0]==='pr' && a[1]==='create') { const head=arg('--head'), base=arg('--base'); s.prs.push({number:s.prs.length+1, head:{ref:head,sha:git('rev-parse',head)},base:{ref:base},merged:false}); save({}); }
else if(a[0]==='pr' && a[1]==='merge') { const pr=s.prs.find(r=>r.number===Number(a[2])); git('push','origin',pr.head.ref+':'+pr.base.ref); if(pr.base.ref==='integration') git('fetch','origin','integration:integration'); pr.merged=true;
 if(s.mode==='changed-version' || s.mode==='changed-notes') { git('fetch','origin'); git('checkout','-B','race','origin/main'); const file=s.mode==='changed-version'?'skills/alpha/skills/alpha/package.json':'skills/alpha/CHANGELOG.md'; let text=fs.readFileSync(repo+'/'+file,'utf8'); text=text.replace(s.mode==='changed-version'?'0.2.0':'Requested notes.',s.mode==='changed-version'?'0.3.0':'Changed notes.'); fs.writeFileSync(repo+'/'+file,text);git('add',file);git('commit','-m','chore: concurrent change');git('push','origin','HEAD:main'); }
 save({}); }
else if(a[0]==='workflow' && a[1]==='run') { if(s.mode!=='no-tag') { git('fetch','origin');git('tag','alpha-v0.2.0','origin/main');git('push','origin','alpha-v0.2.0'); } save({}); }
else {save({error:'unexpected gh',a});process.exit(1);}
`}`);
  execFileSync('chmod', ['+x', join(bin, 'gh')]);
  const old = { PATH: process.env.PATH, FAKE_GH_STATE: process.env.FAKE_GH_STATE, FAKE_GH_REPO: process.env.FAKE_GH_REPO };
  Object.assign(process.env, { PATH: `${bin}:${old.PATH}`, FAKE_GH_STATE: stateFile, FAKE_GH_REPO: f.repo });
  t.after(() => { for (const [key, value] of Object.entries(old)) { if(value === undefined) delete process.env[key]; else process.env[key]=value; } });
  return () => JSON.parse(readFileSync(stateFile, 'utf8'));
}
const cutOptions = { ownerRepo: 'fixture/repo', version: '0.2.0', skipHashCheck: true, waitSeconds: 0, pollSeconds: 1 };

test('GitHub flow status needs no dev and inventories pending components without labels', (t) => {
  const f = fixture(t); const s = readStatus(f.repo, f.config, 'alpha');
  assert.deepEqual(s.blockers, [], 'a main-only origin must be releasable without dev');
  assert.equal(s.workflowPattern, 'github-flow'); assert.equal(s.releaseBase, 'main'); assert.equal(s.versionOnDev, null); assert.deepEqual(s.collateral, []);
  assert.deepEqual(s.pendingComponents.map(c=>c.name), ['beta']);
});
test('prepare commits exact dual-host metadata and both lockfile fields from main', (t) => {
  const f = fixture(t, { dual: true }); const before = git(f.repo, 'rev-parse', 'origin/main');
  const r = prepare(f.repo, f.config, 'alpha', '0.2.0', '- Requested notes.', { date: '2026-09-12' });
  assert.equal(r.ok, true, r.error); // On the base: real preparation fails before any compatibility assertion.
  assert.equal(git(r.worktree, 'rev-parse', 'HEAD^'), before);
  for (const file of f.config.release.componentLayout.versionFiles.filter(p=>p.endsWith('.json'))) {
    const p = file.replaceAll('{name}','alpha'); const v = JSON.parse(git(r.worktree,'show',`HEAD:${p}`)); assert.equal(v.version,'0.2.0',p);
  }
  const lock = JSON.parse(git(r.worktree,'show','HEAD:skills/alpha/skills/alpha/package-lock.json'));
  assert.equal(lock.packages[''].version,'0.2.0'); assert.deepEqual(lock.packages['node_modules/dependency'],{version:'8.7.6',integrity:'sha512-fixture'});
  assert.match(git(r.worktree,'show','HEAD:skills/alpha/skills/alpha/SKILL.md'), /version: 0\.2\.0/);
  assert.match(git(r.worktree,'show','HEAD:skills/alpha/CHANGELOG.md'), /## \[0\.2\.0\] - 2026-09-12\n\n- Requested notes\./);
  assert.equal(git(r.worktree,'diff','HEAD^','HEAD','--','skills/beta','.claude-plugin/marketplace.json','.agents/plugins/marketplace.json'),'');
  assert.match(py(r.worktree,'tools/sync_codex.py','--check'), /checked/);
  assert.match(py(r.worktree,'tools/check_compatibility.py'), /passed/);
  assert.equal(git(r.worktree,'status','--porcelain'),''); assert.equal(git(f.repo,'rev-parse','main'), before);
});
test('dual-host preparation accepts an absent optional lockfile', (t) => {
  const f=fixture(t,{dual:true,lock:false}); const r=prepare(f.repo,f.config,'alpha','0.2.0','- Requested notes.'); assert.equal(r.ok,true,r.error); assert.equal(existsSync(join(r.worktree,'skills/alpha/skills/alpha/package-lock.json')),false);
});
for (const mode of ['stale','missing-generator','failed-generator','failed-compatibility','unexpected-edit']) test(`dual-host preparation refuses ${mode} before committing`, (t) => {
  const f=fixture(t,{dual:true});
  if(mode==='stale') put(f.repo,'skills/beta/.codex-plugin/plugin.json','{}\n');
  if(mode==='missing-generator') rmSync(join(f.repo,'tools/sync_codex.py'));
  if(mode==='failed-generator') put(f.repo,'tools/sync_codex.py','import sys\nraise SystemExit(0 if "--check" in sys.argv else 1)\n');
  if(mode==='failed-compatibility') put(f.repo,'tools/check_compatibility.py','raise SystemExit(1)\n');
  if(mode==='unexpected-edit') put(f.repo,'tools/sync_codex.py',readFileSync(join(f.repo,'tools/sync_codex.py'),'utf8').replace("args = parser.parse_args()", "args = parser.parse_args()\n    if not args.check: (args.repo_root / 'unexpected.txt').write_text('unexpected')"));
  git(f.repo,'add','-A');git(f.repo,'commit','-m','test: fault');git(f.repo,'push','origin','main');
  const before=git(f.repo,'rev-parse','main'); const r=prepare(f.repo,f.config,'alpha','0.2.0','- Requested notes.'); assert.equal(r.ok,false,JSON.stringify(r));
  assert.equal(git(f.repo,'rev-parse','feature/release-alpha-v0.2.0'),before); assert.equal(git(f.repo,'ls-remote','origin','refs/heads/feature/release-alpha-v0.2.0'),'');
});
test('legacy custom integration preparation remains Claude-only and does not require Python', (t) => {
  const f=fixture(t,{legacy:true}); const r=prepare(f.repo,f.config,'alpha','0.2.0','- Requested notes.');assert.equal(r.ok,true,r.error);assert.equal(existsSync(join(r.worktree,'tools')),false);assert.equal(git(r.worktree,'rev-parse','HEAD^'),git(f.repo,'rev-parse','origin/integration'));
  const s=readStatus(f.repo,f.config,'alpha');assert.equal(s.releaseBase,'integration');assert.equal(s.versionOnDev,'0.1.0');
});
for (const mode of ['green','missing','failed','changed-version','changed-notes','no-tag']) test(`cut main-only prepared version: ${mode}`, (t) => {
  const f=fixture(t);const p=prepare(f.repo,f.config,'alpha','0.2.0','- Requested notes.');assert.equal(p.ok,true,p.error);const state=fakeGh(t,f,mode);
  const r=cut(f.repo,f.config,'alpha',cutOptions);const calls=state().calls;
  const create=calls.find(a=>a[0]==='pr'&&a[1]==='create');assert.equal(create[create.indexOf('--base')+1],'main');
  assert.equal(calls.some(a=>a.includes('integration')),false);assert.equal(calls.some(a=>String(a[1]).includes('/labels/')),false);
  if(mode==='green') {assert.equal(r.done,true,JSON.stringify(r));assert.equal(r.tag,'alpha-v0.2.0');assert.equal(calls.filter(a=>a[0]==='workflow').length,1);assert.equal(calls.find(a=>a[0]==='workflow')[2],'alpha.yml');
    git(f.repo,'branch','-D','feature/release-alpha-v0.2.0');
    const resumed=cut(f.repo,f.config,'alpha',cutOptions);assert.equal(resumed.done,true,JSON.stringify(resumed));assert.equal(state().calls.filter(a=>a[0]==='workflow').length,1);
  } else if(mode==='no-tag') {assert.equal(r.done,false,JSON.stringify(r));assert.equal(calls.filter(a=>a[0]==='workflow').length,1);}
  else {assert.equal(calls.some(a=>a[0]==='workflow'),false);if(['missing','failed'].includes(mode)) assert.equal(calls.some(a=>a[0]==='pr'&&a[1]==='merge'),false);if(mode==='missing')assert.equal(r.done,false);else assert.equal(r.ok,false,JSON.stringify(r));}
});
test('stale decisions and mismatched explicit versions never dispatch', (t) => {
  const f=fixture(t);const state=fakeGh(t,f);const s=readStatus(f.repo,f.config,'alpha');
  assert.equal(cut(f.repo,f.config,'alpha',{...cutOptions,skipHashCheck:false,expectStatusHash:'stale'}).ok,false);
  assert.equal(cut(f.repo,f.config,'alpha',{...cutOptions,version:'9.9.9'}).ok,false);
  assert.deepEqual(state().calls,[]);
  assert.equal(resolveReleaseTarget({...s,state:'untagged-bump-on-main'},'9.9.9').ok,false);
});
test('legacy custom integration cut retains promotion before dispatch', (t) => {
  const f=fixture(t,{legacy:true});const p=prepare(f.repo,f.config,'alpha','0.2.0','- Requested notes.');assert.equal(p.ok,true,p.error);const state=fakeGh(t,f);const r=cut(f.repo,f.config,'alpha',cutOptions);assert.equal(r.done,true,JSON.stringify(r));
  assert.deepEqual(state().calls.filter(a=>a[0]==='pr'&&a[1]==='create').map(a=>a[a.indexOf('--base')+1]),['integration','main']);
});
