import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync, cpSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const helper = join(root, 'scripts/traefik.js');
const contract = JSON.parse(readFileSync(join(root, 'evals/capabilities.json'), 'utf8'));
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'traefik-skill-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'config', 'traefik-skill', 'settings.json');
  const cwd = join(dir, 'unrelated'); mkdirSync(cwd);
  const env = { ...process.env, TRAEFIK_DIR: '', XDG_CONFIG_HOME: join(dir, 'config'), PATH: dirname(process.execPath), TK_TEST_MODE: '1' };
  function stack(name = 'stack', response = contract, code) {
    const path = join(dir, name); mkdirSync(join(path, 'scripts'), { recursive: true });
    writeFileSync(join(path, 'compose.yaml'), 'services: {}\n');
    const program = code ?? `require('node:fs').writeFileSync(${JSON.stringify(join(path, 'called.json'))}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),testMode:process.env.TK_TEST_MODE})); console.log(${JSON.stringify(JSON.stringify(response))});`;
    writeFileSync(join(path, 'scripts', 'tk'), `#!${process.execPath}\n${program}\n`, { mode: 0o755 });
    return path;
  }
  function run(args, options = {}) {
    const result = spawnSync(process.execPath, [options.helper || helper, ...args], { cwd: options.cwd || cwd, env: { ...env, ...options.env }, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    return { ...result, data: JSON.parse(result.stdout) };
  }
  return { dir, config, cwd, env, stack, run };
}

test('explicit stack is canonical; arguments are literal and probe strips test mode', (t) => {
  const f = fixture(t); const stack = f.stack('stack $(`touch NOT_EXECUTED`)');
  const r = f.run(['detect', '--stack', stack]);
  assert.equal(r.status, 0); assert.equal(r.data.source, 'argument');
  assert.equal(r.data.stack, stack); assert.equal(r.data.tk, join(stack, 'scripts', 'tk'));
  assert.deepEqual(JSON.parse(readFileSync(join(stack, 'called.json'))), { args: ['capabilities', '--json'], cwd: stack });
  assert.equal(existsSync(join(f.cwd, 'NOT_EXECUTED')), false);
});

test('selection precedence is argument, environment, checkout, binding, PATH', (t) => {
  const f = fixture(t); const explicit = f.stack('explicit'); const environment = f.stack('environment');
  const checkout = f.stack('checkout'); const bound = f.stack('bound'); const onpath = f.stack('onpath');
  mkdirSync(dirname(f.config), { recursive: true }); writeFileSync(f.config, JSON.stringify({ schema_version: 1, stack: bound }));
  const bin = join(f.dir, 'bin'); mkdirSync(bin); symlinkSync(join(onpath, 'scripts', 'tk'), join(bin, 'tk'));
  const env = { TRAEFIK_DIR: environment, PATH: bin }; const cwd = join(checkout, 'scripts');
  assert.equal(f.run(['detect', '--stack', explicit], { env, cwd }).data.stack, explicit);
  assert.equal(f.run(['detect'], { env, cwd }).data.source, 'environment');
  assert.equal(f.run(['detect'], { env: { PATH: bin }, cwd }).data.source, 'checkout');
  assert.equal(f.run(['detect'], { env: { PATH: bin } }).data.stack, bound);
  rmSync(f.config);
  assert.equal(f.run(['detect'], { env: { PATH: bin } }).data.source, 'path');
});

test('invalid explicit selection and environment never fall through to a valid binding', (t) => {
  const f = fixture(t); const stack = f.stack(); assert.equal(f.run(['bind', '--stack', stack]).status, 0);
  for (const options of [{ args: ['detect', '--stack', join(f.dir, 'missing')] }, { args: ['detect'], env: { TRAEFIK_DIR: join(f.dir, 'missing') } }]) {
    const r = f.run(options.args, options); assert.equal(r.status, 1); assert.equal(r.data.error.code, 'invalid_stack');
  }
  const empty = f.run(['detect', '--stack', '']); assert.equal(empty.status, 2);
});

test('bind verifies compatibility before saving and uses a private path-only file', (t) => {
  const f = fixture(t); const stack = f.stack(); const r = f.run(['bind', '--stack', stack]);
  assert.equal(r.status, 0); assert.equal(r.data.saved, true); assert.equal(r.data.readonly, false);
  assert.deepEqual(JSON.parse(readFileSync(f.config)), { schema_version: 1, stack });
  assert.equal(statSync(f.config).mode & 0o777, 0o600);
  const original = readFileSync(f.config, 'utf8');
  const incompatible = f.stack('old', { ...contract, features: contract.features.filter((x) => x !== 'removal-preview-v1') });
  const failure = f.run(['bind', '--stack', incompatible]);
  assert.equal(failure.status, 1); assert.equal(failure.data.error.code, 'cli_incompatible');
  assert.equal(readFileSync(f.config, 'utf8'), original);
});

test('saved binding works from a copied plugin cache outside the stack', (t) => {
  const f = fixture(t); const stack = f.stack(); f.run(['bind', '--stack', stack]);
  const cache = join(f.dir, 'plugin-cache', 'traefik');
  mkdirSync(join(cache, 'scripts'), { recursive: true }); cpSync(helper, join(cache, 'scripts', 'traefik.js'));
  writeFileSync(join(cache, 'package.json'), '{"type":"module","version":"0.1.0"}');
  const r = f.run(['detect'], { helper: (() => { const link = join(f.dir, 'cached-helper'); symlinkSync(join(cache, 'scripts', 'traefik.js'), link); return link; })() });
  assert.equal(r.status, 0); assert.equal(r.data.stack, stack); assert.equal(r.data.source, 'binding');
});

test('broken bindings reject without falling through to PATH', (t) => {
  const f = fixture(t); const stack = f.stack(); const bin = join(f.dir, 'bin'); mkdirSync(bin);
  symlinkSync(join(stack, 'scripts', 'tk'), join(bin, 'tk')); mkdirSync(dirname(f.config), { recursive: true });
  for (const contents of ['broken', '{"schema_version":2}', '{"schema_version":1,"stack":"relative"}']) {
    writeFileSync(f.config, contents); const r = f.run(['detect'], { env: { PATH: bin } });
    assert.equal(r.status, 1); assert.equal(r.data.error.code, 'invalid_binding');
  }
});

test('a CLI symlink into another checkout is not the selected stack CLI', (t) => {
  const f = fixture(t); const a = f.stack('a'); const b = f.stack('b');
  rmSync(join(a, 'scripts', 'tk')); symlinkSync(join(b, 'scripts', 'tk'), join(a, 'scripts', 'tk'));
  assert.equal(f.run(['detect', '--stack', a]).data.error.code, 'invalid_stack');
  assert.equal(existsSync(join(b, 'called.json')), false);
});

test('unsupported protocol and missing command or feature are incompatible', (t) => {
  const f = fixture(t);
  for (const [i, response] of [{ ...contract, protocol_version: 2 }, { ...contract, commands: ['status'] }, { ...contract, features: [] }, { ...contract, ok: false }].entries()) {
    const r = f.run(['detect', '--stack', f.stack(String(i), response)]);
    assert.equal(r.status, 1); assert.equal(r.data.error.code, 'cli_incompatible');
  }
});

test('CLI errors and malformed responses never echo raw private output', (t) => {
  const f = fixture(t);
  for (const [i, code] of ['console.log("PRIVATE_OUTPUT");', 'console.error("PRIVATE_OUTPUT"); process.exit(1);', 'console.log("PRIVATE_OUTPUT".repeat(30000));'].entries()) {
    const r = f.run(['detect', '--stack', f.stack(String(i), null, code)]);
    assert.equal(r.status, 1); assert.equal((r.stdout + r.stderr).includes('PRIVATE_OUTPUT'), false);
  }
});

test('offline replay never probes a stack and emits only the compatibility projection', (t) => {
  const f = fixture(t); const stack = f.stack(); const out = join(f.dir, 'out');
  const r = f.run(['check', '--input', join(root, 'evals/capabilities.json'), '--out', out], { env: { TRAEFIK_DIR: stack } });
  assert.equal(r.status, 0); assert.equal(r.data.mode, 'offline'); assert.equal(r.data.stack, undefined);
  assert.equal(existsSync(join(stack, 'called.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'compatibility.json'))), r.data);
  assert.equal(f.run(['check', '--input', join(root, 'evals/incompatible.json')]).status, 1);
});

test('usage errors cannot silently turn into a stack operation', (t) => {
  const f = fixture(t);
  for (const args of [['bind'], ['remove'], ['detect', '--input', 'x'], ['check'], ['detect', 'extra'], ['detect', '--config', ''], ['detect', '--bogus']]) {
    const r = f.run(args); assert.equal(r.status, 2); assert.equal(r.data.error.code, 'invalid_arguments');
  }
  assert.equal(f.run(['detect']).data.error.code, 'stack_not_found');
});
