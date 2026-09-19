#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const registry=JSON.parse(fs.readFileSync(new URL('../references/sources.json',import.meta.url),'utf8'));
const base=registry.bible.baseURL;
const text=s=>typeof s==='string' && s.trim().length>0;
const requireThat=(ok,message)=>{if(!ok)throw new Error(message);};
export const normalizeText=s=>String(s).replace(/\s+/g,' ').trim();
export function parseReference(reference){
  const m=String(reference).trim().match(/^([1-3]?\s*[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?$/);
  requireThat(m,'Use a book and one chapter or verse range, e.g. John 3 or John 3:14-21. Fetch multi-chapter passages one chapter at a time.');
  const [chapter,first,last]=[Number(m[2]),m[3]?Number(m[3]):null,m[4]?Number(m[4]):m[3]?Number(m[3]):null];
  requireThat(chapter>0 && chapter<=150 && (first===null || first>0 && last>=first && last<=176),'Invalid chapter or verse range');
  return {book:m[1].replace(/\s+/g,' ').trim(),chapter,first,last};
}
function translationCheck(d,id){
  requireThat(d?.translation?.identifier===id,'Bible API returned a different translation; refusing substitution');
  requireThat(text(d.translation.name) && text(d.translation.license),'Bible API response lacks translation name or license');
}
export function checkChapter(d,{translation,bookId,chapter}){
  translationCheck(d,translation);
  requireThat(Array.isArray(d.verses)&&d.verses.length>0,'Bible API returned no verses');
  d.verses.forEach((v,i)=>requireThat(v?.book_id===bookId && v.chapter===chapter && v.verse===i+1 && text(v.book) && v.book===d.verses[0].book && text(v.text),'Bible API returned a wrong book/chapter, duplicate, gap, or empty verse; review the response'));
  return d;
}
export function checkRecord(record){
  requireThat(record?.provider==='bible-api','Scripture must use the shared Bible API provider');
  const parsed=parseReference(record.reference);
  const requested=parseReference(record.requestedReference);
  const sameBook=requested.book.toLowerCase()===parsed.book.toLowerCase() || requested.book.toUpperCase()===record.bookId || requested.book.toLowerCase()==='psalm'&&parsed.book==='Psalms';
  requireThat(sameBook && requested.chapter===parsed.chapter && requested.first===parsed.first && requested.last===parsed.last,'Requested Scripture reference does not match returned passage');
  requireThat(/^\w{3}$/.test(record.bookId??''),'Missing canonical book ID');
  requireThat(/^[a-z0-9-]+$/.test(record.translation?.identifier??''),'Invalid translation ID');
  requireThat(record.url===`${base}/data/${record.translation.identifier}/${record.bookId}/${parsed.chapter}`,'Scripture provenance URL does not match its book, chapter, and translation');
  requireThat(text(record.retrievedAt)&&!Number.isNaN(Date.parse(record.retrievedAt)),'Scripture retrieval timestamp required');
  checkChapter({translation:record.translation,verses:record.contextVerses},{translation:record.translation.identifier,bookId:record.bookId,chapter:parsed.chapter});
  requireThat(record.contextVerses[0].book===parsed.book,'Scripture reference does not match returned book name');
  const expected=record.contextVerses.filter(v=>parsed.first===null || v.verse>=parsed.first && v.verse<=parsed.last);
  requireThat(expected.length>0 && (parsed.first===null || expected.length===parsed.last-parsed.first+1),'Requested verses are absent; refusing a partial passage');
  requireThat(JSON.stringify(record.verses)===JSON.stringify(expected),'Selected verses do not match requested passage and chapter context');
  return record;
}
export function makeClient({cacheDir,offline=false,refresh=false,fetchImpl=globalThis.fetch,delay=ms=>new Promise(r=>setTimeout(r,ms)),interval=2200}={}){
  requireThat(cacheDir,'A cache directory is required');
  requireThat(!(offline&&refresh),'--offline and --refresh cannot be combined');
  let lastRequest=0;
  async function get(url,check){
    const file=path.join(cacheDir,createHash('sha256').update(url).digest('hex')+'.json');
    if(!refresh && fs.existsSync(file)){
      let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Unreadable Bible cache; retry with --refresh');}
      requireThat(saved.url===url && text(saved.retrievedAt),'Invalid Bible cache provenance; retry with --refresh');
      check(saved.data);return saved;
    }
    requireThat(!offline,`No cached Scripture for ${url}; fetch it online first`);
    const wait=Math.max(0,interval-(Date.now()-lastRequest));if(wait)await delay(wait);
    lastRequest=Date.now();
    let response;try{response=await fetchImpl(url,{signal:AbortSignal.timeout(20000),redirect:'error',headers:{Accept:'application/json'}});}catch{throw new Error('Bible API request failed or timed out; retry later or use previously cached Scripture with --offline');}
    if(response.status===429)throw new Error(`Bible API rate limit reached; retry after ${response.headers.get('retry-after')??'at least 30'} seconds. Cached Scripture remains available.`);
    requireThat(response.ok,`Bible API HTTP ${response.status}; verify the requested translation and passage`);
    const body=await response.text();requireThat(body.length<=2_000_000,'Bible API response is unexpectedly large');
    let data;try{data=JSON.parse(body);}catch{throw new Error('Bible API did not return valid JSON');}
    check(data);
    const saved={url,retrievedAt:new Date().toISOString(),data};fs.mkdirSync(cacheDir,{recursive:true});
    const tmp=file+`.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(saved,null,2)+'\n');fs.renameSync(tmp,file);
    return saved;
  }
  return {async passage(reference,translation=registry.bible.defaultTranslation){
    requireThat(/^[a-z0-9-]+$/.test(translation),'Invalid translation ID');
    const parsed=parseReference(reference);
    const catalog=await get(`${base}/data/${translation}`,d=>{
      translationCheck(d,translation);requireThat(Array.isArray(d.books)&&d.books.length>0,'Missing Bible book catalog');
      requireThat(d.books.every(b=>/^\w{3}$/.test(b?.id??'')&&text(b.name)),'Invalid Bible book catalog');
    });
    const name=parsed.book.toLowerCase();
    const book=catalog.data.books.find(b=>b.name.toLowerCase()===name || b.id.toLowerCase()===name || name==='psalm'&&b.name==='Psalms');
    requireThat(book,'Book unavailable in this translation; use its full name or canonical ID. No translation substitution was made.');
    const result=await get(`${base}/data/${translation}/${book.id}/${parsed.chapter}`,d=>checkChapter(d,{translation,bookId:book.id,chapter:parsed.chapter}));
    const canonical=`${result.data.verses[0].book} ${parsed.chapter}${parsed.first===null?'':`:${parsed.first}${parsed.last===parsed.first?'':`-${parsed.last}`}`}`;
    const record={provider:registry.bible.id,requestedReference:reference,reference:canonical,bookId:book.id,url:result.url,retrievedAt:result.retrievedAt,translation:result.data.translation,verses:result.data.verses.filter(v=>parsed.first===null || v.verse>=parsed.first&&v.verse<=parsed.last),contextVerses:structuredClone(result.data.verses)};
    return checkRecord(record);
  }};
}
async function main(args){
  if(args[0]==='sources'){console.log(JSON.stringify(registry,null,2));return;}
  if(!args.length || args.includes('--help')){console.log('bible-data.mjs fetch --reference "John 3" --out passage.json --cache cache-dir [--translation web] [--offline | --refresh]\nbible-data.mjs sources');return;}
  requireThat(args.shift()==='fetch','Use fetch or sources');const opts={};
  while(args.length){const k=args.shift();requireThat(['--reference','--out','--cache','--translation','--offline','--refresh'].includes(k)&&!(k in opts),'Unknown or duplicate option');if(['--offline','--refresh'].includes(k)){opts[k]=true;continue;}requireThat(args[0]&&!args[0].startsWith('--'),`Missing value for ${k}`);opts[k]=args.shift();}
  requireThat(opts['--reference']&&opts['--out']&&opts['--cache'],'--reference, --out, and --cache are required');
  const record=await makeClient({cacheDir:path.resolve(opts['--cache']),offline:opts['--offline'],refresh:opts['--refresh']}).passage(opts['--reference'],opts['--translation']);
  const out=path.resolve(opts['--out']);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(record,null,2)+'\n');
  console.log(`${record.reference}: ${record.verses.length} verses, ${record.translation.name}; full chapter context retained. Saved ${out}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(`bible-data: ${e.message}`);process.exitCode=1;});
