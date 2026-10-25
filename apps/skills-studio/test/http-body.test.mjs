import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from '../server/http-body.mjs';

test('JSON decoding preserves Unicode filenames across incoming byte boundaries', async () => {
  const bytes=Buffer.from(JSON.stringify({name:'résumé résumé.md',prompt:'Read my notes'}));
  const index=bytes.indexOf(Buffer.from('é'))+1;
  const result=await readJsonBody(Readable.from([bytes.subarray(0,index),bytes.subarray(index)]));
  assert.equal(result.name,'résumé résumé.md');
});
test('body limits count actual bytes and reject oversize or invalid requests', async () => {
  await assert.rejects(readJsonBody(Readable.from(['{"prompt":"éé"}']),{limit:10}),error=>error.status===413);
  for (const value of ['not json','null','[]','"hello"']) {
    await assert.rejects(readJsonBody(Readable.from([value])),error=>error.status===400);
  }
  assert.deepEqual(await readJsonBody(Readable.from([])),{});
});
test('an attachment request can use its larger bounded limit without lifting ordinary request limits', async () => {
  const payload=JSON.stringify({attachments:[{name:'notes.txt',data:'A'.repeat(150000)}]});
  await assert.rejects(readJsonBody(Readable.from([payload])),error=>error.status===413);
  assert.equal((await readJsonBody(Readable.from([payload]),{limit:200000})).attachments[0].name,'notes.txt');
});
