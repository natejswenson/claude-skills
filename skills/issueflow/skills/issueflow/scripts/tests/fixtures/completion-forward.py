#!/usr/bin/env python3
"""Local CLI/Git forward scenarios; reviewed-state input is synthetic, process receipts real."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, re, subprocess, tempfile

DEFAULT_SOURCE='__ISSUEFLOW_SOURCE__'
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out');a=p.parse_args();source=Path(a.source).resolve()
root=Path(a.out).resolve() if a.out else Path(tempfile.mkdtemp(prefix='issueflow-completion-replay-'))
if a.out:root.mkdir(parents=True,exist_ok=False)
templates=json.loads(Path(__file__).with_name('issueflow-completion-forward-templates.json').read_text())
now=lambda:datetime.now(timezone.utc).isoformat()
def hashes():return {str(f.relative_to(source)):hashlib.sha256(f.read_bytes()).hexdigest() for f in source.glob('scripts/**/*') if f.is_file()}
(root/'source-before.json').write_text(json.dumps(hashes(),indent=2))
def git(repo,*args):return subprocess.run(['git',*args],cwd=repo,text=True,capture_output=True,check=True).stdout.strip()
def get_json(path):return json.loads(path.read_text())
def put_json(path,value):path.write_text(json.dumps(value,indent=2))
class Fixture:
 def __init__(self,path,loss=True):
  self.root=path;path.mkdir();(path/'bin').mkdir();(path/'logs').mkdir();self.repo=path/'repo';self.repo.mkdir();self.run=path/'run'
  git(None,'init','--bare','--initial-branch=dev',str(path/'origin.git'));git(self.repo,'init','--initial-branch=dev');git(self.repo,'config','user.name','Local Forward Fixture');git(self.repo,'config','user.email','local@example.invalid')
  (self.repo/'counter.cjs').write_text('module.exports = input => input.length + 1;\n');(self.repo/'.issueflow').mkdir();put_json(self.repo/'.issueflow/completion.json',{'schema':1,'readyCanMerge':False,'source':'Local fixture has no readiness automation.'});git(self.repo,'add','.');git(self.repo,'commit','-m','base fixture');base=git(self.repo,'rev-parse','HEAD');git(self.repo,'remote','add','origin',str(path/'origin.git'));git(self.repo,'push','-u','origin','dev')
  state={'repo':{'owner':{'login':'local'},'name':'completion','defaultBranchRef':{'name':'dev'}},'issue':{'number':42,'title':'Correct counter result','body':'Return input length including zero. Do not change callers.','state':'OPEN','url':'https://github.com/local/completion/issues/42','labels':[],'comments':[]},'pr':{'number':101,'node_id':'PR_LOCAL_101','html_url':'https://github.com/local/completion/pull/101','title':'Correct counter result','state':'open','draft':True,'merged':False,'merged_at':None,'merge_commit_sha':None,'head':{'sha':None,'ref':'feature/issue-42'},'base':{'ref':'dev','sha':base},'mergeable':True,'mergeable_state':'clean','auto_merge':None},'comments':{},'nextCommentId':1,'failReadyReadOnce':loss,'failPrView':0,'readyWrites':0,'deployments':[],'deploymentStatuses':{},'deployWrites':0,'checkStartedAt':now()};put_json(path/'provider.json',state)
  for name,key in [('bin/gh','gh'),('setup-reviewed.mjs','setup')]:
   text=templates[key].replace('__FIXTURE_ROOT__',str(path)).replace(DEFAULT_SOURCE,str(source));(path/name).write_text(text)
  (path/'bin/gh').chmod(0o755);self.env=os.environ.copy();self.env['PATH']=str(path/'bin')+os.pathsep+self.env['PATH'];self.env['CODEX_THREAD_ID']='completion-forward-session';self.env.pop('ISSUEFLOW_SESSION_ID',None);self.env.pop('NODE_TEST_CONTEXT',None);self.env['GIT_ALLOW_PROTOCOL']='file';self.env['GIT_CONFIG_GLOBAL']='/dev/null';self.env['GIT_CONFIG_NOSYSTEM']='1'
  result=subprocess.run(['node',str(path/'setup-reviewed.mjs')],env=self.env,text=True,capture_output=True);put_json(path/'logs/setup.json',{'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr});assert result.returncode==0,result.stderr
 def state(self):return get_json(self.run/'run.json')
 def provider(self):return get_json(self.root/'provider.json')
 def provider_write(self,p):put_json(self.root/'provider.json',p)
 def command(self,label,*args,expected=0):
  argv=['node',str(source/'scripts/issueflow.js'),*map(str,args),'--run-dir',str(self.run)];result=subprocess.run(argv,env=self.env,text=True,capture_output=True);put_json(self.root/'logs'/f'{label}.json',{'argv':argv,'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'hashes':hashes()});assert result.returncode==expected,f'{label}: exit {result.returncode}, expected {expected}: {result.stderr}\n{result.stdout}';return result
 def publish(self,brief,output,value):
  output.write_text(value if isinstance(value,str) else json.dumps(value,indent=2));match=re.search(r"node '([^']+complete-worker.mjs)' '([^']+request.json)'",brief.read_text());assert match,brief
  result=subprocess.run(['node',match[1],match[2]],env=self.env,text=True,capture_output=True);put_json(self.root/'logs'/f'deliver-{output.name}.json',{'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr});assert result.returncode==0,result.stderr
 def intent(self,name,value):
  file=self.root/f'intent-{name}.json';put_json(file,value);return self.command('intent-'+name,'completion-intent','--file',file)

f=Fixture(root/'completion')
f.command('ready-response-loss','ready','--lane','root',expected=4)
assert f.provider()['readyWrites']==1
f.command('ready-recovery','ready','--lane','root');assert f.provider()['readyWrites']==1
old=f.state();old_receipts=[r['path'] for r in old['lanes'][0]['verification']['receipts']]
plan=(f.root/'plan.md').read_text();match=re.search(r'```issueflow-contract\n([\s\S]*?)\n```',plan);contract=json.loads(match[1]);contract['allowedPaths'].append('README.md');plan=plan[:match.start(1)]+json.dumps(contract,indent=2)+plan[match.end(1):];plan=plan.replace('- `test/counter.test.cjs`\n','- `test/counter.test.cjs`\n- `README.md`\n');file=f.root/'amended-plan.md';file.write_text(plan)
f.command('amend-propose','amend','--plan',file,'--reason','Simulated user requested a usage README','--authority-source','Local fixture user request authorizes README scope','--workers-released')
f.command('amend-brief','amend-review-brief');e=f.state()['harness']['publishedAmendment'];f.publish(Path(e['review']['brief']),Path(e['review']['output']),{'findings':[],'notExamined':['Synthetic local review output; native quality not tested.'],'verdict':'pass','resolutions':[],'proposalHash':e['proposalHash']})
f.command('amend-register','amend-register');f.command('amend-apply','amend-apply','--workers-released');state=f.state();assert state['lanes'][0]['pr']['number']==101;assert 'verification' not in state['lanes'][0];assert all(Path(p).exists() for p in old_receipts)
f.command('amend-implementation-brief','next','--workers-released');tree=f.run/'worktrees/root';(tree/'README.md').write_text('# Counter\n\nCall the exported function with an array to return its length.\n');git(tree,'add','README.md');git(tree,'commit','-m','add reviewed README');git(tree,'push','origin','feature/issue-42');head=git(tree,'rev-parse','HEAD');provider=f.provider();provider['pr']['head']['sha']=head;provider['checkStartedAt']=now();f.provider_write(provider)
f.publish(f.run/'briefs/root-implement.md',f.run/'root/implement.md','# Amended implementation\n\n## Changed\nAdded reviewed usage README.\n\n## Deviations\nNone.\n\n## Command\nnode --test test/counter.test.cjs and node --test from cwd .\n\n## Two-sided\nThe controller runs original-base regression assertions and current-head green checks.\n\n## Result\nReviewed changes committed; native reviewer quality is not part of this local fixture.\n')
f.command('amend-implementation-accept','next','--workers-released');brief=f.run/'briefs/root-review-r2-finder-1.md';assert brief.exists();f.publish(brief,f.run/'root/review/r2/candidates-1.json',{'candidates':[],'notExamined':['Synthetic local reviewer output; native quality unverified.']})
f.command('amend-code-review-ready','next','--workers-released');assert f.state()['lanes'][0]['review']['converged'];assert len(f.state()['lanes'][0]['review']['rounds'])==2;assert f.provider()['readyWrites']==1
f.intent('merged',{'endpoint':'merged','source':'Simulated existing user requested merge'});f.command('merge-authority','completion-authorize','--action','merge','--authority-source','Simulated existing user authorized this exact PR head','--lane','root','--head',head);result=f.command('merge-capability-stop','completion',expected=2);assert 'cannot atomically enforce' in result.stderr
# A user-performed merge is a provider event, corroborated by actual local Git integration.
git(f.repo,'merge','--ff-only','feature/issue-42');git(f.repo,'push','origin','dev');git(f.repo,'push','origin','--delete','feature/issue-42');provider=f.provider();provider['pr'].update({'merged':True,'state':'closed','merged_at':now(),'merge_commit_sha':head});provider['pr']['base']['sha']=head;f.provider_write(provider)
f.intent('deployed',{'endpoint':'deployed','source':'Simulated existing user requested deployment','deployments':[{'service':'counter','environment':'fixture','adapter':'github-deployments','lane':'root'}]});f.command('deploy-authority','completion-authorize','--action','deploy','--authority-source','Simulated existing deployment authorization','--head',head,'--environment','fixture')
f.command('deployment-response-loss','completion',expected=4);f.command('deployment-pending','completion',expected=2);f.command('cleanup-before-deployment','finish',expected=2);assert tree.exists();assert f.provider()['deployWrites']==1;assert f.state()['completion']['obligations']['merge:root']['observed']['commit']==head
provider=f.provider();provider['deploymentStatuses']['1']=[{'id':2,'state':'success','created_at':now(),'environment_url':'https://example.invalid'}];f.provider_write(provider);f.command('deployment-recovery','completion');assert f.provider()['deployWrites']==1;ops=[o for o in f.state()['operations'].values() if o['kind']=='deploy'];assert len(ops)==1 and ops[0]['state']=='confirmed',ops
f.command('endpoint-cleanup','next','--workers-released');assert f.state()['finished'];assert not tree.exists();assert not git(f.repo,'for-each-ref','--format=%(refname)','refs/heads/feature/issue-42')
# A separate explicit draft-only request must neither lift draft nor claim it did.
d=Fixture(root/'draft',loss=False);d.intent('draft',{'endpoint':'reviewed-pr','excluded':['ready','merge'],'source':'Simulated user requested the PR remain a draft'});d.command('draft-next','next');d.command('draft-direct-ready','ready','--lane','root',expected=2);assert d.provider()['readyWrites']==0 and d.provider()['pr']['draft']
# A review-only endpoint permits readiness but must not demand an excluded merge.
e=Fixture(root/'review-only',loss=False);e.intent('review-only',{'endpoint':'reviewed-pr','excluded':['merge'],'source':'Explicit review-only fixture endpoint'});result=e.command('review-only-ready','ready','--lane','root');assert e.provider()['readyWrites']==1;assert 'USER ACTION REQUIRED' not in result.stdout;assert 'finish` once the pull requests merge' not in result.stdout
final=hashes();put_json(root/'source-after.json',final);changed=[p for p,v in get_json(root/'source-before.json').items() if final.get(p)!=v];put_json(root/'result.json',{'passed':True,'sourceChangedDuringReplay':changed,'nativeSessions':False,'githubMutations':False,'simulatedReadyWrites':f.provider()['readyWrites'],'simulatedDeployWrites':f.provider()['deployWrites'],'completionFinished':bool(f.state()['finished']),'draftPreserved':d.provider()['pr']['draft'],'limitations':['Initial reviewed state and worker review outputs are synthetic.','Verification commands, Git operations, controller transitions and receipt/journal handling are real local execution.','Built-in merge submission safely stops on unsupported target-context capability; user-performed merge was simulated and locally integrated.']});print(root)
