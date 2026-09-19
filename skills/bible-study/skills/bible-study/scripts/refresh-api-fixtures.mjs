#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkChapter,registry} from './bible-data.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--from')throw new Error('Use --from <reviewed real API cache directory>');
const entries=[['books-web',`${registry.bible.baseURL}/data/web`],['john-3',`${registry.bible.baseURL}/data/web/JHN/3`]];
const checked=entries.map(([name,url])=>{
 const file=path.join(args[1],createHash('sha256').update(url).digest('hex')+'.json');
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 if(saved.url!==url || !saved.retrievedAt || saved.data?.translation?.identifier!=='web')throw new Error('Cache provenance or translation mismatch');
 if(name==='john-3'){
  checkChapter(saved.data,{translation:'web',bookId:'JHN',chapter:3});
  if(saved.data.verses.length!==36)throw new Error('John 3 must have 36 verses; inspect the response');
 }else if(!saved.data.books?.some(b=>b.id==='JHN'&&b.name==='John'))throw new Error('Missing John in book catalog');
 return [name,saved.data];
});
for(const [name,data] of checked)fs.writeFileSync(new URL(`../evals/input/api/${name}.json`,import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log('Frozen reviewed API cache responses; run npm test.');
