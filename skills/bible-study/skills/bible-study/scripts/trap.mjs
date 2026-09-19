import fs from 'node:fs';
import {validate} from './bible-study.js';
const d=JSON.parse(fs.readFileSync(new URL('../evals/input/john-3.json',import.meta.url)));
d.sources[1].kind='secular';
const errors=validate(d);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
