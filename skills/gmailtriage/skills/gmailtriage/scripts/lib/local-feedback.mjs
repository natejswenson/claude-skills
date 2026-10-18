/** Explicit, private local feedback only. No inference, rules or mailbox access. */
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, linkSync, unlinkSync, constants } from 'node:fs';
import { join } from 'node:path';
import { assertLocalPath } from './local-model.mjs';
import { hasProtectedSubject } from './plan.mjs';
import { parseAddress } from './sender.mjs';
const fail = message => { throw new Error(`learn-local: ${message}`); };
const fields = (value,keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k=>Object.hasOwn(value,k));
const text = (value,max) => typeof value === 'string' && !!value.trim() && [...value].length <= max;
const recordFields = ['schemaVersion','eventId','confirmed','source','sender','subject','choices','selectedChoiceId','sourceId'];
export function validateFeedbackBatch(batch) {
  if (!fields(batch,['schemaVersion','examples']) || batch.schemaVersion !== 1 || !Array.isArray(batch.examples) || batch.examples.length < 1 || batch.examples.length > 200) fail('expected schemaVersion 1 and 1..200 examples');
  return batch.examples.map(r=>{
    if (!fields(r,recordFields) || r.schemaVersion !== 1 || r.confirmed !== true || !['filed-mail-review','triage-review'].includes(r.source) ||
      typeof r.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.eventId) ||
      !text(r.sender,254) || r.sender !== parseAddress(r.sender)?.address || !text(r.subject,160)) fail('invalid or unconfirmed feedback record');
    if (hasProtectedSubject([r])) fail('protected subjects cannot be captured');
    if (!Array.isArray(r.choices) || r.choices.length < 2 || r.choices.length > 12 || r.choices.some(c=>!fields(c,['id','description']) || !text(c.id,64) || !text(c.description,200)) ||
      new Set(r.choices.map(c=>c.id)).size !== r.choices.length || new Set(r.choices.map(c=>c.description)).size !== r.choices.length ||
      (r.selectedChoiceId !== null && !r.choices.some(c=>c.id === r.selectedChoiceId))) fail('invalid offered choices or selection');
    const sourceId=createHash('sha256').update(JSON.stringify([r.sender.toLowerCase(),r.subject])).digest('hex');
    if (r.sourceId !== sourceId) fail('sourceId must match the sender and subject SHA256');
    // Stable key order makes retries independent of JSON object field order.
    return Object.fromEntries(recordFields.map(k=>[k,k === 'choices' ? r.choices.map(c=>({id:c.id,description:c.description})) : r[k]]));
  });
}
export function assertPrivateFeedbackPath(path,{directory=false}={}) {
  const absolute=assertLocalPath(path,{directory});
  const stat=lstatSync(absolute);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink !== 1)) fail('expected a regular private path without symlink or hardlink');
  if ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || (process.getuid && stat.uid !== process.getuid())) fail('feedback paths must be private (directory 0700, file 0600) and owned by you');
  return absolute;
}
export function readFeedbackBatch(input) {
  const path=assertPrivateFeedbackPath(input);
  const fd=openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(readFileSync(fd,'utf8')); }
  catch { fail('invalid review JSON'); }
  finally { closeSync(fd); }
}
// Recover only the disposable internal namespace, never arbitrary aliases.
function recoverFeedbackTemporaries(directory) {
  const pending=[];
  for (const name of readdirSync(directory)) {
    if (!/^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(name)) continue;
    const path=join(directory,name),stat=lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid()) || ![1,2].includes(stat.nlink)) fail('suspicious internal temporary record');
    // A sole link was never committed; even a partial write is disposable.
    if (stat.nlink === 1) { pending.push(path);continue; }
    const fd=openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW);
    let record;
    try { record=JSON.parse(readFileSync(fd,'utf8')); }
    catch { fail('invalid internal temporary record'); }
    finally { closeSync(fd); }
    record=validateFeedbackBatch({schemaVersion:1,examples:[record]})[0];
    let event;
    try { event=lstatSync(join(directory,record.eventId+'.json')); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
    if (!event || !event.isFile() || event.isSymbolicLink() || event.dev !== stat.dev || event.ino !== stat.ino) fail('internal temporary record has unexpected aliases');
    pending.push(path);
  }
  // Verify all recovery candidates before removing any temporary names.
  for (const path of pending) unlinkSync(path);
  if (pending.length) {
    const fd=openSync(directory,'r');try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}

export function captureFeedback(batch,store) {
  const records=validateFeedbackBatch(batch),events=new Map();
  for (const record of records) {
    const data=JSON.stringify(record)+'\n';
    if (events.has(record.eventId) && events.get(record.eventId).data !== data) fail('conflicting event data');
    events.set(record.eventId,{data});
  }
  let exists=false;
  try { lstatSync(store); exists=true; } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const directory=assertLocalPath(store,{directory:exists});
  mkdirSync(directory,{recursive:true,mode:0o700});
  assertPrivateFeedbackPath(directory,{directory:true});
  recoverFeedbackTemporaries(directory);
  const matches = (path,data) => {
    try { lstatSync(path); } catch(error) { if(error.code === 'ENOENT') return false;throw error; }
    const existing=validateFeedbackBatch({schemaVersion:1,examples:[readFeedbackBatch(path)]})[0];
    if (JSON.stringify(existing)+'\n' !== data) fail('event already exists with different data');
    return true;
  };
  // Refuse conflicts before capturing any new event in this batch.
  for (const [id,{data}] of events) matches(join(directory,id+'.json'),data);
  let captured=0,existing=0;
  for (const record of records) {
    const path=join(directory,record.eventId+'.json'),data=events.get(record.eventId).data;
    if(matches(path,data)){existing++;continue;}
    const temporary=join(directory,'.'+randomUUID()+'.tmp');
    try {
      const fd=openSync(temporary,'wx',0o600);
      try { writeFileSync(fd,data);fsyncSync(fd); } finally {closeSync(fd);}
      try { linkSync(temporary,path);captured++; }
      catch(error) { if(error.code !== 'EEXIST') throw error;existing++; }
    } finally { unlinkSync(temporary); }
    // After unlinking the temporary name, the committed record has one link.
    if (!matches(path,data)) fail('event capture failed');
  }
  const fd=openSync(directory,'r');try { fsyncSync(fd); } finally { closeSync(fd); }
  return {captured,existing};
}
