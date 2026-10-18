import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexClient, requireSubscription } from '../server/codex.mjs';

test('transport correlates out-of-order replies and emits server requests separately', async () => {
  const script = `
    const readline = require('node:readline');
    const reply = value => process.stdout.write(JSON.stringify(value)+'\\n');
    readline.createInterface({input:process.stdin}).on('line', line => {
      const m=JSON.parse(line);
      if(m.method==='first') setTimeout(()=>reply({id:m.id,result:{value:1}}),30);
      if(m.method==='second') {reply({id:m.id,result:{value:2}});reply({id:99,method:'approval',params:{}});}
      if(m.method==='environment') reply({id:m.id,result:{hasKey:!!process.env.OPENAI_API_KEY,hasCodexKey:!!process.env.CODEX_API_KEY}});
      if(m.method==='failure') reply({id:m.id,error:{message:'Real protocol error'}});
    });`;
  const client = new CodexClient({ command: process.execPath, args: ['-e', script], env: { ...process.env, OPENAI_API_KEY: 'must-not-reach-child', CODEX_API_KEY: 'must-not-reach-child' } });
  try {
    const events=[];client.on('event',event=>events.push(event));
    const result=await Promise.all([client.request('first'),client.request('second')]);
    assert.deepEqual(result,[{value:1},{value:2}]);
    assert.equal(events[0].id,99);
    assert.deepEqual(await client.request('environment'),{hasKey:false,hasCodexKey:false});
    await assert.rejects(client.request('failure'), /Real protocol error/);
  } finally { client.close(); }
});
test('transport rejects requests when a subprocess exits and clears stalled requests', async () => {
  const exiting = new CodexClient({command:process.execPath,args:['-e','process.exit(2)']});
  await assert.rejects(exiting.request('hello'), /disconnected/);
  const stalled=new CodexClient({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeout:20});
  try { await assert.rejects(stalled.request('hello'), /timed out/);assert.equal(stalled.pending.size,0); } finally { stalled.close(); }
});
test('API keys, missing accounts and external token modes cannot satisfy subscription gate', () => {
  for (const account of [null,{type:'apiKey'},{type:'chatgptAuthTokens'}]) assert.throws(()=>requireSubscription(account),/subscription/);
  requireSubscription({type:'chatgpt'});
});
