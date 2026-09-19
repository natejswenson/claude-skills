#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {render} from './bible-study.js';
const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=='--from')throw new Error('Use --from <visually reviewed real-run output directory>');
const observed=fs.readFileSync(path.resolve(args[1],'study.html'));
const expected=Buffer.from(render(JSON.parse(fs.readFileSync(new URL('../evals/input/john-3.json',import.meta.url)))));
if(!observed.equals(expected))throw new Error('The observed run does not match current reviewed input and renderer; investigate before freezing');
const base=new URL('../evals/baseline/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('MANIFEST.json',base)));
manifest.artifacts=[{path:'study.html',bytes:observed.length,sha256:createHash('sha256').update(observed).digest('hex')}];
fs.writeFileSync(new URL('study.html',base),observed);
fs.writeFileSync(new URL('MANIFEST.json',base),JSON.stringify(manifest,null,2)+'\n');
console.log('Frozen the supplied reviewed John 3 run. Run npm test.');
