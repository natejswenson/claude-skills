#!/usr/bin/env node
// Explicitly synthetic persistent offline GitHub adapter; never contacts a network.
const fs=require('node:fs');const cp=require('node:child_process');const path=require('node:path');
const root=process.env.ISSUEFLOW_FAKE_GH_ROOT;
if(!root)throw Error('ISSUEFLOW_FAKE_GH_ROOT must name an isolated synthetic fixture');const statePath=path.join(root,'fake-gh-state.json');
const state=JSON.parse(fs.readFileSync(statePath));const args=process.argv.slice(2);const val=x=>args[args.indexOf(x)+1];
const remote=path.join(root,'remote.git');
const git=(...a)=>cp.execFileSync('git',a,{cwd:remote,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const save=()=>fs.writeFileSync(statePath,JSON.stringify(state,null,2));
const out=x=>{save();console.log(typeof x==='string'?x:JSON.stringify(x));};
fs.appendFileSync(path.join(root,'fake-gh-calls.jsonl'),JSON.stringify({at:new Date().toISOString(),cwd:process.cwd(),args})+'\n');
const pr=()=>{if(!state.pr)throw Error('no synthetic PR');return {...state.pr,headRefOid:git('rev-parse',state.pr.headRefName)};};
try{
if(args[0]==='repo'&&args[1]==='view')out({owner:{login:'offline'},name:'count-prflow',defaultBranchRef:{name:'dev'}});
else if(args[0]==='issue'&&args[1]==='view')out({...state.issue,comments:state.comments.map(c=>({body:c.body,url:c.html_url,author:{login:'offline'}}))});
else if(args[0]==='issue'&&args[1]==='comment'){
 const id=100+state.comments.length;const html_url=`https://example.invalid/offline/count-prflow/issues/1#issuecomment-${id}`;
 state.comments.push({id,body:fs.readFileSync(val('--body-file'),'utf8'),html_url,user:{login:'offline'}});out(html_url);
}else if(args[0]==='pr'&&args[1]==='list')out(state.pr&&(!args.includes('--head')||val('--head')===state.pr.headRefName)?[pr()]:[]);
else if(args[0]==='pr'&&args[1]==='create'){
 if(state.pr)throw Error('duplicate synthetic PR creation');
 state.pr={id:'PR_offline_42',number:42,url:'https://example.invalid/offline/count-prflow/pull/42',headRefName:val('--head'),baseRefName:val('--base'),title:val('--title'),body:fs.readFileSync(val('--body-file'),'utf8'),isDraft:args.includes('--draft'),state:'OPEN',mergedAt:null};out(state.pr.url);
}else if(args[0]==='pr'&&args[1]==='view')out(pr());
else if(args[0]==='pr'&&args[1]==='checks'){
 const head=pr().headRefOid;let check=state.ci.find(c=>c.head===head);
 if(!check){const cwd=fs.mkdtempSync(path.join(root,'ci-'));for(const f of ['count.cjs','count.test.cjs'])fs.writeFileSync(path.join(cwd,f),git('show',`${head}:${f}`)+'\n');const result=cp.spawnSync(process.execPath,['--test','--test-reporter=tap'],{cwd,encoding:'utf8'});check={head,cwd,exit:result.status,stdout:result.stdout,stderr:result.stderr};state.ci.push(check);}
 out([{name:'test',bucket:check.exit===0?'pass':'fail',state:check.exit===0?'SUCCESS':'FAILURE',link:`https://example.invalid/ci/${head}`}]);
}else if(args[0]==='pr'&&args[1]==='ready'){state.pr.isDraft=false;out(state.pr.url);}
else if(args[0]==='pr'&&args[1]==='comment'){state.prComments.push(fs.readFileSync(val('--body-file'),'utf8'));out(state.pr.url+'#issuecomment-'+(200+state.prComments.length));}
else if(args[0]==='api'&&args[1]==='user')out('offline');
else if(args[0]==='api'&&args[1].includes('/issues/1/comments'))out(args.includes('--slurp')?[state.comments]:state.comments);
else if(args[0]==='api'&&args[1].includes('/issues/42/comments')){if(state.failSummaryReadOnce){state.failSummaryReadOnce=false;throw Error('Synthetic interruption after ready, before summary');}const comments=state.prComments.map((body,i)=>({id:201+i,body,html_url:state.pr.url+'#issuecomment-'+(201+i),user:{login:'offline'}}));out(args.includes('--slurp')?[comments]:comments);}
else if(args[0]==='api'&&args[1].includes('/issues/comments/')){
 const c=state.comments.find(c=>c.id===Number(args[1].split('/').pop()));if(!c)throw Error('unknown checkpoint comment');c.body=JSON.parse(fs.readFileSync(val('--input'))).body;out(c.html_url);
}else if(args[0]==='api'&&args[1]==='graphql'){
 const input=JSON.parse(fs.readFileSync(val('--input')));const q=input.query;const v=input.variables??{};state.graphql.push(input);
 if(q.startsWith('query(')&&q.includes('node(id:')){
  let node;if(q.includes('reviews(first:'))node={headRefOid:pr().headRefOid,reviews:{nodes:state.reviews,pageInfo:{hasNextPage:false,endCursor:null}}};
  else if(q.includes('reviewThreads(first:'))node={headRefOid:pr().headRefOid,reviewThreads:{nodes:state.threads,pageInfo:{hasNextPage:false,endCursor:null}}};
  else {const t=state.threads.find(t=>t.id===v.id);node={id:t.id,isResolved:t.isResolved,comments:{nodes:t.comments.nodes,pageInfo:{hasNextPage:false,endCursor:null}}};}
  out({data:{viewer:{login:'offline'},node}});
 }
 else if(q.includes('addPullRequestReview(')){const r={id:'PRR_'+(state.reviews.length+1),body:v.body,submitted:false,state:'PENDING',commit:{oid:v.head??pr().headRefOid},author:{login:'offline'}};state.reviews.push(r);out({data:{addPullRequestReview:{pullRequestReview:{id:r.id}}}});}
 else if(q.includes('addPullRequestReviewThread(')){const t={id:'PRRT_'+(state.threads.length+1),path:v.path,line:v.line,isResolved:false,isOutdated:false,comments:{nodes:[{id:'C_1',body:v.body,author:{login:'offline'},pullRequestReview:{id:v.review}}]},review:v.review};state.threads.push(t);out({data:{addPullRequestReviewThread:{thread:{id:t.id}}}});}
 else if(q.includes('submitPullRequestReview(')){const r=state.reviews.find(r=>r.id===v.review);r.submitted=true;r.state='COMMENTED';r.body=v.body;r.url=state.pr.url+'#pullrequestreview-'+r.id;out({data:{submitPullRequestReview:{pullRequestReview:{id:r.id,url:r.url}}}});}
 else if(q.includes('addPullRequestReviewThreadReply(')){const t=state.threads.find(t=>t.id===v.thread);t.comments.nodes.push({id:'C_'+(t.comments.nodes.length+1),body:v.body,author:{login:'offline'}});out({data:{addPullRequestReviewThreadReply:{comment:{id:'C_'+t.comments.nodes.length}}}});}
 else if(q.includes('resolveReviewThread(')){const t=state.threads.find(t=>t.id===v.thread);t.isResolved=true;out({data:{resolveReviewThread:{thread:{id:t.id,isResolved:true}}}});}
 else if(q.includes('reviewThreads'))out({data:{repository:{pullRequest:{reviewThreads:{nodes:state.threads,pageInfo:{hasNextPage:false,endCursor:null}}}}}});
 else throw Error('unsupported synthetic GraphQL '+q);
}else throw Error('unsupported fake gh command '+JSON.stringify(args));
}catch(error){save();console.error(error.message);process.exitCode=1;}
