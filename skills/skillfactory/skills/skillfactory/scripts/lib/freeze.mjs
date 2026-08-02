/**
 * Freeze — the only step that turns a run into an eval.
 *
 * This is skillfactory's one rule made mechanical. A skill is not done when its files
 * exist; it is done when a real run of it has been captured and pinned. Freeze
 * takes the directory a real run actually wrote and the command that produced
 * it, copies the artifacts in, and generates a baseline test that RE-RUNS that
 * command and byte-compares. The eval is therefore reproducible rather than
 * decorative: it fails when behaviour changes, not merely when someone edits a
 * fixture.
 *
 * Two rules the generated test cannot be talked out of:
 *
 *   - an anti-vacuity floor. A manifest covering zero artifacts must go RED.
 *     A corpus check iterating an empty glob passes while asserting nothing,
 *     and that is the single most common way a gate turns into decoration.
 *   - two-sidedness. Without a known-bad case the baseline goes green the day
 *     someone weakens the checker, so freeze emits a FAILING trap placeholder
 *     when no trap is supplied rather than a one-sided pass.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Commands that reach the network cannot be a CI baseline: they cost money and they flake. */
const NETWORK_HINTS = [/\bcurl\b/, /\bwget\b/, /\bgh\s+api\b/, /\bnpm\s+(install|ci)\b/, /https?:\/\//];

export function looksNetworked(command) {
  return NETWORK_HINTS.filter((re) => re.test(command)).map((re) => String(re));
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push(relative(base, abs));
  }
  return out.sort();
}

/**
 * Copy a real run's output into evals/baseline/ and write MANIFEST.json.
 * Returns the manifest.
 */
export function freezeRun(skillDir, fromDir, { command, label = 'the-real-run', allowNetwork = false }) {
  if (!existsSync(fromDir) || !statSync(fromDir).isDirectory()) {
    throw new Error(`--from ${fromDir}: not a directory. Freeze pins a real run's output, so there has to be one.`);
  }
  const artifacts = walk(fromDir);
  if (artifacts.length === 0) {
    throw new Error(`--from ${fromDir}: empty. A baseline over zero artifacts asserts nothing and would report "all clean" forever.`);
  }
  if (!command) throw new Error('--command is required: without it the baseline pins bytes nobody can reproduce.');
  const networked = looksNetworked(command);
  if (networked.length > 0 && !allowNetwork) {
    throw new Error(
      `--command looks networked (${networked.join(', ')}). A CI baseline that calls the network costs money and flakes; ` +
        'pass --allow-network only if you are certain it does not.',
    );
  }

  const baselineDir = join(skillDir, 'evals', 'baseline');
  mkdirSync(baselineDir, { recursive: true });

  const files = [];
  for (const rel of artifacts) {
    const buf = readFileSync(join(fromDir, rel));
    const dest = join(baselineDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, buf);
    files.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
  }

  const manifest = {
    $comment:
      'Frozen from a REAL run of this skill, not a synthetic fixture. `command` reproduces it: the baseline test re-runs it into a temp directory and byte-compares against these artifacts.',
    label,
    command,
    artifacts: files,
  };
  writeFileSync(join(baselineDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * The baseline test freeze generates: two-sided, floored, and reproducible.
 * `$OUT` in the recorded command is substituted with a fresh temp directory.
 */
export const baselineTest = (spec, manifest, trap) => `import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const BASELINE = join(SKILL, 'evals', 'baseline');
const manifest = JSON.parse(readFileSync(join(BASELINE, 'MANIFEST.json'), 'utf8'));

// Pinned against a real run of ${spec.name}. Refresh with:
//   ${manifest.command.replace('$OUT', '<a fresh dir>')}
//   skillfactory freeze --skill ${spec.name} --from <that dir> --command ${JSON.stringify(manifest.command)}

const sh = (cmd, cwd) => execFileSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });

test('the frozen run covers real artifacts', () => {
  // Anti-vacuity floor: a manifest over zero artifacts would let every
  // assertion below iterate nothing and still report green.
  assert.ok(manifest.artifacts.length >= ${manifest.artifacts.length}, 'the frozen run lost artifacts — refresh or explain');
  for (const a of manifest.artifacts) {
    assert.ok(existsSync(join(BASELINE, a.path)), \`frozen artifact missing: \${a.path}\`);
  }
});

test('re-running the frozen command reproduces it byte for byte', () => {
  const out = mkdtempSync(join(tmpdir(), '${spec.name}-baseline-'));
  sh(manifest.command.replaceAll('$OUT', out), SKILL);
  for (const a of manifest.artifacts) {
    const produced = readFileSync(join(out, a.path));
    const frozen = readFileSync(join(BASELINE, a.path));
    assert.deepEqual(produced, frozen, \`\${a.path} drifted from the frozen run — inspect the diff before refreshing\`);
  }
});

${
  trap
    ? `test('the known-bad case still fails', () => {
  // Two-sided. A baseline that only asserts good-input-passes goes green the
  // day someone weakens the checker.
  assert.throws(
    () => sh(${JSON.stringify(trap.command)}, SKILL),
    'the known-bad input stopped failing — the checker has been weakened, not the input fixed',
  );
});`
    : `test('the known-bad case still fails', () => {
  // ---------------------------------------------------------------------
  // NOT SUPPLIED. This baseline is one-sided, which means it goes green the
  // day someone weakens a checker. Give freeze a case that MUST fail:
  //     skillfactory freeze --skill ${spec.name} … --trap-command "<a command that must exit non-zero>"
  // ---------------------------------------------------------------------
  assert.fail('no known-bad case frozen — a one-sided baseline is not a baseline');
});`
}
`;
