/**
 * The press masthead, spliced into a generated workflow.
 *
 * The brand is never written down here. press's `gha-header` emitter produces
 * the body and press's `region` module owns the marker format and the receipt
 * hash — ghfactory only decides *which* workflow gets one and what it says. Copying
 * the banner shape into this repo would recreate exactly the failure press
 * exists to end: one brand, hand-ported, drifting quietly.
 *
 * Resolution is deliberately two-step. Installed from npm, `@natjswenson/press`
 * is a real dependency and resolves normally. Inside this monorepo the published
 * version may not yet contain the emitter this file needs (press 0.8.0 adds it),
 * so the in-repo checkout wins when it is there. The alternative — waiting for a
 * publish before ghfactory's own tests can run — makes the two skills unlandable
 * together.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_REPO = resolve(HERE, '../../../../press/skills/press');

async function pressModule(name) {
  if (existsSync(join(IN_REPO, 'lib', name))) {
    return import(pathToFileURL(join(IN_REPO, 'lib', name)).href);
  }
  const require = createRequire(import.meta.url);
  return import(pathToFileURL(require.resolve(`@natjswenson/press/lib/${name}`)).href);
}

/** press's own version — the receipt the region carries. */
export async function pressVersion() {
  if (existsSync(join(IN_REPO, 'package.json'))) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(join(IN_REPO, 'package.json'), 'utf8')).version;
  }
  const require = createRequire(import.meta.url);
  return require('@natjswenson/press/package.json').version;
}

export const REGION = 'gha-header';
export const SYNTAX = 'yaml';

/**
 * Render the masthead block for a workflow.
 *
 * `title` becomes the tracked-caps eyebrow, `purpose` the one-line standfirst.
 * Both are required by the emitter — a masthead with no purpose is decoration,
 * and the purpose line is the only place a reader learns what the file is for
 * without reading the YAML.
 */
export async function headerBody({ title, purpose, generatorVersion }) {
  const [{ loadTokens }, { emitBody }] = await Promise.all([
    pressModule('tokens.mjs'), pressModule('emit.mjs'),
  ]);
  return emitBody(loadTokens(), 'gha-header', {
    title,
    purpose,
    generator: 'ghfactory',
    generator_version: generatorVersion,
  }, { version: await pressVersion() });
}

export async function renderHeader(opts) {
  const { renderRegion } = await pressModule('region.mjs');
  return renderRegion(REGION, SYNTAX, await headerBody(opts), await pressVersion());
}

/** Splice or insert the masthead at the very top of a workflow document. */
export async function applyHeader(text, opts) {
  const { findRegion, spliceRegion } = await pressModule('region.mjs');
  const block = await renderHeader(opts);
  if (findRegion(text, REGION, SYNTAX)) {
    return spliceRegion(text, REGION, SYNTAX, block.split('\n').slice(1, -1).join('\n'), await pressVersion());
  }
  return `${block}\n${text.replace(/^\s+/, '')}`;
}

/**
 * Is the masthead on disk what press would emit today?
 *
 * `press check` cannot answer this: it walks a static registry of known files,
 * and a workflow ghfactory generated lives in a repo press has never heard of. Same
 * guarantee, dynamic target set.
 */
export async function checkHeader(text, opts) {
  const { findRegion, bodyHash } = await pressModule('region.mjs');
  const found = findRegion(text, REGION, SYNTAX);
  if (!found) return { status: 'missing' };
  const expected = await renderHeader(opts);
  const body = expected.split('\n').slice(1, -1).join('\n');
  // Two comparisons, both required. The marker's recorded hash against today's
  // expected output catches a stale emitter; the ACTUAL body's hash catches a
  // hand-edited region. Checking only the receipt — the original bug — reported
  // "ok" on a region whose content had been tampered under an intact marker.
  if (found.hash !== bodyHash(body) || bodyHash(found.body) !== bodyHash(body)) {
    return { status: 'drift', expected: body, actual: found.body };
  }
  const version = await pressVersion();
  if (found.version !== version) return { status: 'stale-version', was: found.version, now: version };
  return { status: 'ok' };
}
