/**
 * One-command refresh for the frozen masthead BODY.
 *
 * The body, deliberately, not the whole block: the block's start marker carries
 * press's version, so freezing it would make every press release break forge's
 * CI for a change that altered nothing forge emits. The marker format is press's
 * contract and press's own tests cover it.
 *
 * Every byte-exact fixture needs an obvious way to regenerate it, or the first
 * intentional change turns into hand-editing a golden — which is how a golden
 * stops meaning anything.
 *
 *   node evals/baseline/update.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerBody } from '../../lib/header.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const body = await headerBody({
  title: 'CI · node test',
  purpose: 'Lint and test on every pull request into main.',
  generatorVersion: '0.1.0',
});

writeFileSync(join(HERE, 'masthead.txt'), `${body}\n`);
console.log('wrote evals/baseline/masthead.txt');
