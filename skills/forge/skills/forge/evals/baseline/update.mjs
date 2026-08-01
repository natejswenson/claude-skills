/**
 * One-command refresh for the frozen masthead.
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
import { renderHeader } from '../../lib/header.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const block = await renderHeader({
  title: 'CI · node test',
  purpose: 'Lint and test on every pull request into main.',
  generatorVersion: '0.1.0',
});

writeFileSync(join(HERE, 'masthead.txt'), `${block}\n`);
console.log('wrote evals/baseline/masthead.txt');
