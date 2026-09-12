import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'skills/shipflow/skills/shipflow/package.json'));
const { parse } = require('yaml');
const read = p => readFileSync(join(root, p), 'utf8');
const policy = JSON.parse(read('.github/shipflow.json'));
const workflow = name => parse(read(`.github/workflows/${name}.yml`));

test('repository selects main-only GitHub flow before invoking cutover tooling', () => {
  assert.equal(policy.workflowPattern, 'github-flow', 'repository still uses dev promotion');
  assert.deepEqual(policy.branches, { main: 'main' });
  assert.deepEqual(policy.branchCleanup.protectedBranches, ['main']);
  assert.equal(policy.mergeMethod.devToMainMethod, 'squash');
  assert.equal(policy.release.mode, 'manual-gate');
  assert.equal(policy.release.componentLayout.tagPattern, '{name}-v{version}');
  for (const file of ['skills/{name}/skills/{name}/package-lock.json', 'skills/{name}/.codex-plugin/plugin.json']) {
    assert.ok(policy.release.componentLayout.versionFiles.includes(file));
  }
});

// Deliberately limited expression grammar: unknown syntax refuses evaluation.
// The actual parsed caller expression is evaluated for all relevant events.
function releaseAllowed(expression, event, ref) {
  const values = { 'github.event_name': event, 'github.ref': ref };
  return expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '').split(/\s*&&\s*/).every(term => {
    const m = /^(github\.(?:event_name|ref))\s*==\s*'([^']+)'$/.exec(term.trim());
    assert.ok(m, `unsupported guard expression: ${term}`);
    return values[m[1]] === m[2];
  });
}

test('every skill reports stable checks on main and stacks; only main dispatch reaches release', () => {
  const expected = policy.release.components.map(n => `ci / ${n}`).sort();
  assert.deepEqual([...policy.requiredChecks].sort(), expected);
  const contexts = JSON.parse(read('.github/repo-settings.sh').match(/"contexts":\s*(\[[^\]]*\])/)[1]);
  assert.deepEqual(contexts.sort(), expected);
  for (const name of policy.release.components) {
    const w = workflow(name);
    assert.deepEqual(w.on.pull_request.branches, ['main', 'feature/**'], name);
    assert.equal(w.on.pull_request.paths, undefined, name);
    assert.equal(w.on.pull_request['paths-ignore'], undefined, name);
    assert.equal(w.jobs.ci.name, `ci / ${name}`);
    assert.equal(w.jobs.release.needs, 'ci');
    assert.equal(w.jobs.release.uses, './.github/workflows/_release.yml');
    for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
      for (const ref of ['refs/heads/main', 'refs/heads/dev', 'refs/heads/feature/demo']) {
        assert.equal(releaseAllowed(w.jobs.release.if, event, ref),
          event === 'workflow_dispatch' && ref === 'refs/heads/main', `${name} ${event} ${ref}`);
      }
    }
  }
  assert.equal(workflow('security').on.pull_request, null, 'security retains every PR base');
});

test('tools CI executes this regression with declared runtimes on policy and stack changes', () => {
  const w = workflow('tools');
  assert.deepEqual(w.on.pull_request.branches, ['main', 'feature/**']);
  for (const event of ['push', 'pull_request']) {
    for (const path of ['tools/**', '.github/**', 'AGENTS.md', 'CLAUDE.md', 'README.md',
      'docs/github-flow-cutover.md', 'skills/shipflow/**', 'skills/release/**']) {
      assert.ok(w.on[event].paths.includes(path), `${event}: ${path}`);
    }
  }
  const steps = w.jobs.test.steps;
  assert.ok(steps.some(s => s.run === 'node --test tools/tests/github-flow-cutover.test.mjs' && !s.if));
  assert.ok(steps.some(s => s.run === 'python -m pytest tools/tests -q'));
  assert.ok(steps.some(s => s.uses?.startsWith('actions/setup-node@') && s.with['node-version'] === '22'));
  assert.ok(steps.some(s => s.uses?.startsWith('actions/setup-python@') && s.with['python-version'] === '3.12'));
  assert.ok(steps.some(s => s.run === 'npm ci --ignore-scripts --no-audit --no-fund'
    && s['working-directory'] === 'skills/shipflow/skills/shipflow'));
  assert.ok(!policy.requiredChecks.includes('test'), 'path-filtered tools job is not required');
});

const ghSource = String.raw`#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process');
const a = process.argv.slice(2), file = process.env.CUTOVER_STATE;
const s = JSON.parse(fs.readFileSync(file));
const git = (...args) => cp.execFileSync('git', ['-C', process.env.CUTOVER_REPO, ...args], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const fail = (message='HTTP 404') => {save();process.stderr.write(message);process.exit(1);};
if(a[0]!=='api') {s.mutations.push(a);fail('unexpected non-API command');}
const endpoint=a.find(x=>x.startsWith('repos/')).split('/').slice(3).join('/'), path=endpoint.split('?')[0];
const method=a.includes('-X')?a[a.indexOf('-X')+1]:'GET';
const input=a.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):null;
if(method!=='GET') {s.mutations.push({path,method,input}); if(s.fail===path) {s.fail=null;fail('HTTP 500 simulated partial failure');}}
let out;
const list = value => a.includes('--slurp') ? [value] : value;
const enabled = p => Object.fromEntries(Object.entries(p).map(([k,v])=>[k,typeof v==='boolean'?{enabled:v}:v]));
if(path==='') {
 if(method==='PATCH') for(let i=0;i<a.length;i++) if(a[i]==='-F') {const [k,v]=a[++i].split('=');s.settings[k]=v==='true'?true:v==='false'?false:v;}
 out=s.settings;
} else if(path==='vulnerability-alerts') out=null;
else if(path.startsWith('git/ref/heads/')) {try {out={object:{sha:git('rev-parse','--verify',path.slice(14))}};} catch {fail();}}
else if(path==='git/refs/heads/dev'&&method==='DELETE') {git('branch','-D','dev');out=null;if(s.lostDelete){s.lostDelete=false;fail('HTTP 502 response lost after deletion');}}
else if(path.startsWith('git/trees/')) {out={truncated:!!s.truncated,tree:git('ls-tree','-r',path.slice(10)).split('\n').filter(Boolean).map(l=>{const [meta,path]=l.split('\t');const [mode,type,sha]=meta.split(' ');return {path,mode,type,sha};})};}
else if(path.startsWith('git/blobs/')) out={encoding:'base64',content:Buffer.from(git('cat-file','blob',path.slice(10))+'\n').toString('base64')};
else if(path.startsWith('compare/')) {const [base,head]=decodeURIComponent(path.slice(8)).split('...');out={ahead_by:Number(git('rev-list','--count',base+'..'+head)),files:git('diff','--name-only',base,head).split('\n').filter(Boolean).map(filename=>({filename}))};}
else if(path==='tags') {let tags='';try{tags=git('tag');}catch{}out=list(tags.split('\n').filter(Boolean).map(name=>({name,commit:{sha:git('rev-parse',name)}})));}
else if(path==='rulesets') out=list([]);
else if(path.startsWith('branches/')) {
 const branch=path.split('/')[1];
 if(method==='DELETE'){s.protection[branch]=null;out=null;}
 else if(method==='PUT'){s.protection[branch]=enabled(input);out=s.protection[branch];}
 else {out=s.protection[branch];if(!out)fail();}
} else if(path==='pulls') out=list(s.prs.filter(p=>p.state==='open'));
else if(/^pulls\/\d+$/.test(path)) {const pr=s.prs.find(p=>p.number===Number(path.split('/')[1]));if(!pr)fail();if(method==='PATCH')pr.base.ref=input.base;out=pr;}
else if(/^pulls\/\d+\/files$/.test(path)) out=list([{filename:'skills/demo/CHANGELOG.md'}]);
else if(path==='issues') out=list(s.prs.filter(p=>p.labels.includes('release-pending')).map(p=>({number:p.number,pull_request:{}})));
else if(/^issues\/\d+\/labels/.test(path)) {const pr=s.prs.find(p=>p.number===Number(path.split('/')[1]));if(method==='DELETE')pr.labels=pr.labels.filter(x=>x!=='release-pending');out=list(pr.labels.map(name=>({name})));}
else if(path==='actions/workflows') out=list({workflows:s.workflows});
else if(/actions\/workflows\/\d+/.test(path)) {const w=s.workflows.find(w=>w.id===Number(path.split('/')[2]));if(method==='PUT')w.state='disabled_manually';out=w;}
else if(path==='actions/runs') out=list({workflow_runs:s.runs});
else fail('unhandled endpoint '+path);
save();process.stdout.write(JSON.stringify(out));
`;

function fixture(t, { unique = false, prs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'github-flow-cutover-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'), bin = join(dir, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  const write = (path, data) => { const full = join(repo, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, data); };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  const config = { ...policy, workflowPattern: 'github-flow', branches: { main: 'main' }, requiredChecks: ['ci / demo'], release: { ...policy.release, components: ['demo'] } };
  write('.github/shipflow.json', JSON.stringify(config));
  write('.github/repo-settings.sh', read('.github/repo-settings.sh').replace(/"contexts":\s*\[[^\]]*\]/, '"contexts": ["ci / demo"]'));
  write('.github/workflows/main-automerge.yml', 'name: fixture\n');
  write('skills/demo/skills/demo/package.json', '{"version":"1.0.0"}\n');
  git('add', '.'); git('commit', '-m', 'main'); git('tag', 'demo-v1.0.0'); git('branch', 'dev');
  if (unique) {git('switch', 'dev'); write('unique.txt', 'keep me'); git('add', '.'); git('commit', '-m', 'dev-only work'); git('switch', 'main');}
  const stateFile = join(dir, 'state.json'), audit = join(dir, 'audit.json'), journal = join(dir, 'journal.json');
  const settings = {default_branch:'main',allow_auto_merge:true,allow_squash_merge:true,allow_merge_commit:false,allow_rebase_merge:false,delete_branch_on_merge:true};
  const protection = {required_status_checks:{strict:false,contexts:['ci / demo']},required_pull_request_reviews:{required_approving_review_count:0},enforce_admins:{enabled:false},allow_deletions:{enabled:false},allow_force_pushes:{enabled:false},required_linear_history:{enabled:true}};
  const state = {settings, protection:{main:protection,dev:protection}, prs, workflows:[{id:1,path:'.github/workflows/dev-to-main-automerge.yml',state:'active'}],runs:[],mutations:[]};
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(join(bin, 'gh'), ghSource, { mode: 0o755 });
  const get = () => JSON.parse(readFileSync(stateFile));
  const update = fn => {const s=get();fn(s);writeFileSync(stateFile,JSON.stringify(s));};
  const invoke = (...args) => spawnSync('python3', [join(root,'tools/github_flow_cutover.py'),'--repository','test/repo',...args],
    {encoding:'utf8', env:{...process.env, PATH:bin+':'+process.env.PATH,CUTOVER_STATE:stateFile,CUTOVER_REPO:repo}});
  return {dir, repo, audit, journal, git, write, get, update,
    inspect:()=>invoke('audit','--output',audit),
    execute:step=>invoke('execute','--audit',audit,'--state',journal,'--checkout',repo,'--step',step)};
}
const good = r => assert.equal(r.status, 0, r.stderr || r.stdout);
const pr = (number, base='dev', head='feature/work') => ({number,state:'open',head:{ref:head,sha:'a'.repeat(40)},base:{ref:base},labels:[],merged:false,checks:[{name:'ci / demo',conclusion:'failure'}]});

test('audit is read-only; dev-only commits refuse all cutover mutations', t => {
  const f=fixture(t,{unique:true}); good(f.inspect());
  assert.equal(JSON.parse(readFileSync(f.audit)).uniqueDevCommits,1);
  const result=f.execute('retire'); assert.equal(result.status,1); assert.match(result.stderr,/unique dev work/);
  assert.deepEqual(f.get().mutations,[]); assert.ok(f.git('rev-parse','dev'));
});

test('stale SHAs and incomplete inventory refuse mutation', t => {
  const f=fixture(t); good(f.inspect()); f.write('new.txt','new');f.git('add','.');f.git('commit','-m','main changed');
  assert.match(f.execute('settings').stderr,/branch SHAs changed/);assert.deepEqual(f.get().mutations,[]);
  const another=fixture(t);another.update(s=>s.truncated=true);assert.equal(another.inspect().status,1);assert.deepEqual(another.get().mutations,[]);
});

test('open dev PRs block retirement; retarget preserves upper stacks and never merges failed CI', t => {
  const f=fixture(t,{prs:[pr(7),pr(8,'feature/work','feature/upper')]});good(f.inspect());
  assert.match(f.execute('retire').stderr,/open dev PR bases/);
  good(f.execute('retarget'));
  assert.deepEqual(f.get().prs.map(p=>p.base.ref),['main','feature/work']);
  good(f.execute('retarget'));
  assert.equal(f.get().mutations.filter(m=>m.path==='pulls/7').length,1);
  assert.ok(!f.get().mutations.some(m=>m.path?.endsWith('/merge')||Array.isArray(m)));
  good(f.execute('retire'));assert.throws(()=>f.git('rev-parse','--verify','dev'));
  assert.ok(JSON.parse(readFileSync(f.journal)).recovery.branches.dev);
});

test('settings failure is retryable and failing protection read-back prevents retirement', t => {
  const f=fixture(t);good(f.inspect());f.update(s=>{s.settings.allow_merge_commit=true;s.fail='branches/main/protection';});
  assert.equal(f.execute('settings').status,1);
  assert.equal(JSON.parse(readFileSync(f.journal)).operations[0].status,'attempted');
  good(f.execute('settings'));f.update(s=>s.protection.main.required_status_checks.contexts=[]);
  assert.match(f.execute('retire').stderr,/required checks differ/);assert.ok(f.git('rev-parse','dev'));
});

test('old reminder resolution retains pending components independent of labels', t => {
  const reminder={...pr(4,'main','dev'),state:'closed',merged:true,labels:['release-pending']};
  const f=fixture(t,{prs:[reminder]});f.write('skills/demo/skills/demo/package.json','{"version":"1.1.0"}\n');f.git('add','.');f.git('commit','-m','unreleased bump');good(f.inspect());
  assert.match(f.execute('retire').stderr,/promotion reminders/);good(f.execute('reminders'));good(f.execute('retire'));
  const journal=JSON.parse(readFileSync(f.journal));
  assert.deepEqual(journal.recovery.pendingReminders[0].components,['demo']);
  assert.equal(journal.finalAudit.components[0].pending,true);assert.equal(journal.finalAudit.components[0].versionOnMain,'1.1.0');
  assert.deepEqual(journal.finalAudit.pendingReminders,[]);
});

test('lost deletion response resumes without discarding original recovery state or tags', t => {
  const f=fixture(t);good(f.inspect());f.update(s=>s.lostDelete=true);
  assert.equal(f.execute('retire').status,1);const original=JSON.parse(readFileSync(f.journal)).recovery;
  good(f.execute('retire'));assert.deepEqual(JSON.parse(readFileSync(f.journal)).recovery,original);
  assert.equal(f.git('tag'),'demo-v1.0.0');assert.equal(f.get().workflows[0].state,'disabled_manually');
});

test('active workflows refuse deletion and no-dev audits still discover component releases', t => {
  const f=fixture(t);good(f.inspect());f.update(s=>s.runs=[{id:9,status:'in_progress'}]);
  assert.match(f.execute('retire').stderr,/active workflow runs/);assert.ok(f.git('rev-parse','dev'));
  const other=fixture(t);other.git('branch','-D','dev');good(other.inspect());
  const observed=JSON.parse(readFileSync(other.audit));assert.equal(observed.branches.dev,null);assert.equal(observed.components.length,1);assert.equal(observed.components[0].pending,false);
});
