#!/usr/bin/env node
/** Resolve an external tk installation; never implement or proxy stack mutations. */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const REQUIRED = ['inspection-json-v1', 'lifecycle-json-v1', 'lifecycle-explicit-targets', 'lifecycle-dry-run', 'bounded-readiness', 'removal-preview-v1', 'checkout-mutation-lock', 'tls-probes', 'local-memory-readiness'];
const COMMANDS = ['list', 'status', 'doctor', 'inspect', 'logs', 'start', 'stop', 'restart', 'rebuild', 'wait', 'remove'];
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
class SkillError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new SkillError(code, message); };
const configPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'traefik-skill', 'settings.json');
const expand = (value) => value.startsWith('~/') ? join(homedir(), value.slice(2)) : resolve(value);

export function checkCapabilities(data) {
  if (!data || data.ok !== true || data.command !== 'capabilities' || data.schema_version !== 1 || data.protocol_version !== 1
      || !Array.isArray(data.commands) || !Array.isArray(data.features)
      || COMMANDS.some((name) => !data.commands.includes(name)) || REQUIRED.some((name) => !data.features.includes(name))) {
    fail('cli_incompatible', 'This skill requires tk agent protocol 1 with scoped lifecycle and preview-first removal. Update the external CLI; do not substitute raw Compose mutations.');
  }
  return { ok: true, compatible: true, protocol_version: 1, required_capabilities: REQUIRED };
}

function validRoot(candidate) {
  try {
    const stack = realpathSync(expand(candidate));
    const tk = realpathSync(join(stack, 'scripts', 'tk'));
    if (dirname(dirname(tk)) !== stack || basename(dirname(tk)) !== 'scripts'
        || !statSync(tk).isFile() || !COMPOSE.some((name) => existsSync(join(stack, name)))) {
      fail('invalid_stack', 'Select the stack checkout containing a Compose file and its own scripts/tk.');
    }
    accessSync(tk, constants.X_OK);
    return { stack, tk };
  } catch (error) {
    if (error instanceof SkillError) throw error;
    fail('invalid_stack', 'The selected stack needs an accessible Compose file and executable scripts/tk.');
  }
}

function resolveStack(values) {
  if (values.stack) return { ...validRoot(values.stack), source: 'argument' };
  if (process.env.TRAEFIK_DIR) return { ...validRoot(process.env.TRAEFIK_DIR), source: 'environment' };
  let directory = process.cwd();
  while (true) {
    if (existsSync(join(directory, 'scripts', 'tk')) && COMPOSE.some((name) => existsSync(join(directory, name)))) {
      return { ...validRoot(directory), source: 'checkout' };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const config = values.config || configPath();
  if (existsSync(config)) {
    let binding;
    try { binding = JSON.parse(readFileSync(config, 'utf8')); } catch { fail('invalid_binding', 'The saved stack binding is invalid JSON; rebind with an explicit --stack.'); }
    if (binding?.schema_version !== 1 || typeof binding.stack !== 'string' || !isAbsolute(binding.stack)) fail('invalid_binding', 'The saved stack binding is invalid; rebind with an explicit --stack.');
    return { ...validRoot(binding.stack), source: 'binding' };
  }
  for (const entry of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const executable = join(entry, 'tk');
    if (!existsSync(executable)) continue;
    let target;
    try { target = realpathSync(executable); } catch { continue; }
    if (basename(dirname(target)) !== 'scripts') continue;
    return { ...validRoot(dirname(dirname(target))), source: 'path' };
  }
  fail('stack_not_found', 'No stack is selected. Use detect --stack /path/to/traefik or bind --stack /path/to/traefik.');
}

function detect(values) {
  const selected = resolveStack(values);
  const env = { ...process.env };
  delete env.TK_TEST_MODE;
  const result = spawnSync(selected.tk, ['capabilities', '--json'], {
    cwd: selected.stack, env, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) fail('cli_unavailable', 'The external tk capability check failed or timed out. Update/check that CLI and retry; no stack operation was requested.');
  let data;
  try { data = JSON.parse(result.stdout); } catch { fail('cli_incompatible', 'The external CLI did not return a JSON capability contract. Update tk before operating the stack.'); }
  return { ...checkCapabilities(data), ...selected, capabilities: data, readonly: true };
}

function saveBinding(path, stack) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ schema_version: 1, stack }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function main(args = process.argv.slice(2)) {
  let command;
  try {
    let parsed;
    try { parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
      stack: { type: 'string' }, config: { type: 'string' }, input: { type: 'string' }, out: { type: 'string' },
      json: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
    } }); } catch { fail('invalid_arguments', 'Use detect, bind --stack PATH, or check --input FILE; see --help.'); }
    const { values, positionals } = parsed;
    if (Object.values(values).some((value) => value === '')) fail('invalid_arguments', 'Path options must not be empty.');
    if (values.help || (!positionals.length && !values.version)) {
      console.log('traefik-skill: detect [--stack PATH] [--config FILE] | bind --stack PATH [--config FILE] | check --input FILE [--out DIR]\nOutputs JSON. detect only probes tk capabilities; bind stores a host-local path; check validates a recorded contract offline.');
      return 0;
    }
    if (values.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); return 0; }
    [command] = positionals;
    if (positionals.length !== 1 || !['detect', 'bind', 'check'].includes(command)) fail('invalid_arguments', 'Specify exactly one supported command; see --help.');
    if (command === 'check') {
      if (!values.input || values.stack || values.config) fail('invalid_arguments', 'check requires --input FILE; it never selects or operates a live stack.');
      let data;
      try { data = JSON.parse(readFileSync(values.input, 'utf8')); } catch { fail('invalid_input', 'Cannot read a JSON capability response from the input file.'); }
      const report = { ...checkCapabilities(data), mode: 'offline' };
      if (values.out) {
        mkdirSync(values.out, { recursive: true });
        writeFileSync(join(values.out, 'compatibility.json'), JSON.stringify(report, null, 2) + '\n');
      }
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (values.input || values.out || (command === 'bind' && !values.stack)) fail('invalid_arguments', 'bind requires an explicit --stack; detect/bind do not accept replay files or output directories.');
      const report = detect(values);
      if (command === 'bind') {
        const path = values.config || configPath();
        saveBinding(path, report.stack);
        report.binding = resolve(path);
        report.saved = true;
        report.readonly = false;
      }
      console.log(JSON.stringify(report, null, 2));
    }
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, command, error: { code: error.code && error instanceof SkillError ? error.code : 'io_error',
      message: error instanceof SkillError ? error.message : 'Cannot access the required file or executable.' } }, null, 2));
    return error.code === 'invalid_arguments' ? 2 : 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
