#!/usr/bin/env node
/**
 * appletv — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts — and the one fact that matters most is the verdict: a send ends
 * in verified, mismatch or unverifiable, decided by scripts/lib/verify.mjs
 * from a state read back off the device, never from the command having been
 * sent.
 *
 * Live commands write their captures to --out <dir>; `report --from <dir>`
 * renders the same tables from those captures with no device attached, which
 * is what the frozen baseline replays.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { aliasesFor, configPath, loadConfig, rememberDevices, resolveDevice, saveConfig } from './lib/config.mjs';
import { DRIVER, SKILL_DIR, VENV, drive, driveAsync, systemPython, venvPython } from './lib/driver.mjs';
import { explain } from './lib/errors.mjs';
import { appsTable, scanTable, sendRows, sendTable, stateTable, summarize, table, typeTable } from './lib/report.mjs';
import { launchTarget, textVerdict, verdict } from './lib/verify.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PIN_FILE = () => process.env.APPLETV_PIN_FILE || join(dirname(configPath()), 'pairing.pin');

/** Flags that never take a value, so `--keep-going up` keeps `up` as the command. */
const BOOL_FLAGS = new Set(['keepGoing', 'force', 'default', 'debug', 'append', 'clear', 'get', 'version']);

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (BOOL_FLAGS.has(key)) out[key] = true;
      else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export { table };

class Fail extends Error {
  constructor(code, detail, extra = {}) {
    const e = explain(code, detail);
    super(`${e.message}${e.detail ? ` (${e.detail})` : ''}\n  fix: ${e.fix}`);
    this.code = code;
    Object.assign(this, extra);
  }
}

const say = (s) => process.stdout.write(`${s}\n`);
const outDir = (args) => {
  const dir = args.out || process.env.APPLETV_OUT;
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  return resolve(dir);
};
const capture = (dir, name, obj) => {
  if (!dir) return;
  writeFileSync(join(dir, name), `${JSON.stringify(obj, null, 2)}\n`);
};

function failFrom(res) {
  return new Fail(res.error, res.detail);
}

// ---------------------------------------------------------------------------
// doctor — is the machine able to talk to an Apple TV at all
// ---------------------------------------------------------------------------
async function cmdDoctor(args) {
  const rows = [];
  const sys = systemPython();
  rows.push(['python3', sys ? `${sys.version} (${sys.bin})` : 'missing', sys ? 'ok' : 'install Python 3 ≥ 3.9']);
  if (!sys) throw new Fail('no_python');

  let py = venvPython();
  if (!py || args.install) {
    if (!py || args.install === 'fresh') {
      say(py ? 'recreating the skill venv…' : 'creating the skill venv and installing pyatv…');
      if (py) rmSync(VENV, { recursive: true, force: true });
      const mk = spawnSync(sys.bin, ['-m', 'venv', VENV], { encoding: 'utf8' });
      if (mk.status !== 0) throw new Fail('no_python', mk.stderr.trim());
    } else say('upgrading pyatv in the skill venv…');
    const pip = spawnSync(join(VENV, 'bin', 'pip'), ['install', '-q', '--upgrade', 'pyatv'], { encoding: 'utf8', timeout: 300_000 });
    if (pip.status !== 0) throw new Fail('no_pyatv', pip.stderr.trim().split('\n').pop());
    py = venvPython();
  }
  const d = drive('doctor');
  rows.push(['venv', VENV.replace(homedir(), '~'), py ? 'ok' : 'missing']);
  rows.push(['pyatv', d.ok ? d.pyatv : 'missing', d.ok ? 'ok' : explain(d.error, d.detail).fix]);
  if (!d.ok) { say(table(['Check', 'Value', 'Status'], rows)); throw failFrom(d); }
  rows.push(['credentials', d.storage.replace(homedir(), '~'), existsSync(d.storage) ? 'present' : 'none yet — pair first']);
  const cfg = loadConfig();
  const n = Object.keys(cfg.devices).length;
  rows.push(['config', configPath().replace(homedir(), '~'), n ? `${n} device${n > 1 ? 's' : ''} remembered${cfg.default ? ', default set' : ', no default'}` : 'no devices yet — scan first']);
  say(table(['Check', 'Value', 'Status'], rows));
}

// ---------------------------------------------------------------------------
// scan — who is on the network
// ---------------------------------------------------------------------------
async function cmdScan(args) {
  const dir = outDir(args);
  const dargs = [];
  if (args.hosts) dargs.push('--hosts', String(args.hosts));
  if (args.timeout) dargs.push('--timeout', String(args.timeout));
  say(args.hosts ? `asking ${args.hosts} directly…` : 'scanning the network for apple tvs…');
  const res = drive('scan', dargs, { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  const cfg = rememberDevices(loadConfig(), res.devices, res.captured_at);
  saveConfig(cfg);
  capture(dir, 'scan.json', res);
  if (res.devices.length === 0) {
    const e = explain('scan_empty');
    say(table(['Apple TV', 'Model', 'tvOS', 'Address', 'Paired', 'Needs pairing', 'Alias'], [['(none found)', '—', '—', '—', '—', '—', '—']]));
    say(`\n${e.message} after ${res.seconds}s (${res.mode}${res.ignored.length ? `; ignored ${res.ignored.join(', ')} — not a TV` : ''}).\n  fix: ${e.fix}`);
    process.exitCode = 1;
    return;
  }
  say(scanTable(res, (id) => aliasesFor(cfg, id)));
  const unpaired = res.devices.filter((d) => !d.services.some((s) => s.paired));
  if (unpaired.length) say(`\n${unpaired.length} not paired yet — \`appletv pair --device "${unpaired[0].name}"\` to pair one.`);
}

// ---------------------------------------------------------------------------
// device resolution shared by everything that talks to one TV
// ---------------------------------------------------------------------------
function pickDevice(args) {
  const cfg = loadConfig();
  const query = args.device ?? null;
  const r = resolveDevice(cfg, query);
  if (r.ok) return { cfg, id: r.id, device: r.device, via: r.via };
  if (query && /^\d+\.\d+\.\d+\.\d+$/.test(query)) return { cfg, id: null, device: { name: query, address: query }, via: 'address' };
  const cands = r.candidates.map((c) => c.name).join(', ');
  throw new Fail(r.error, cands ? `known: ${cands}` : 'run `appletv scan` first');
}

function deviceArgs(pick) {
  const a = [];
  if (pick.id) a.push('--id', pick.id);
  if (pick.device.address) a.push('--address', pick.device.address);
  return a;
}

/** Drive a per-device subcommand; if the cached address is stale, retry by identifier over multicast. */
function driveDevice(sub, pick, extra = [], opts = {}) {
  let res = drive(sub, [...deviceArgs(pick), ...extra], opts);
  if (!res.ok && res.error === 'device_not_found' && pick.id && pick.device.address) {
    res = drive(sub, ['--id', pick.id, ...extra], opts);
  }
  return res;
}

// ---------------------------------------------------------------------------
// pair — one PIN per protocol, session kept alive across the wait
// ---------------------------------------------------------------------------
const UNLOCKS = { airplay: 'now-playing, play/pause/skip, volume (MRP rides inside AirPlay on tvOS 15+)', companion: 'apps, deep links, keyboard, power on/off, guide' };

async function cmdPair(args) {
  if (args.pin && !args.device && !args.protocol) {
    const f = PIN_FILE();
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `${String(args.pin).trim()}\n`);
    say(`PIN delivered to the waiting pairing session (${f.replace(homedir(), '~')}).`);
    return;
  }
  const pick = pickDevice(args);
  const want = args.protocol && args.protocol !== 'all' ? [String(args.protocol).toLowerCase()] : ['airplay', 'companion'];
  const already = new Set(pick.device.paired ?? []);
  const rows = [];
  for (const proto of want) {
    if (already.has(proto) && !args.force) { rows.push([proto, 'already paired', UNLOCKS[proto] ?? '']); continue; }
    const pinFile = PIN_FILE();
    rmSync(pinFile, { force: true });
    const dargs = [...deviceArgs(pick), '--protocol', proto, '--pin-file', pinFile, '--pin-timeout', String(args.pinTimeout ?? 120)];
    if (args.pin) dargs.push('--pin', String(args.pin));
    say(`pairing ${proto} with ${pick.device.name}…`);
    const res = await driveAsync('pair', dargs, {
      debug: !!args.debug,
      onPhase: (p) => {
        if (p.phase === 'pin_needed') say(`\n  ▶ ${pick.device.name} is showing a PIN for ${proto}. Deliver it within ${Math.round(Number(args.pinTimeout ?? 120) / 60)} minutes:\n      appletv pair --pin <the code on the screen>\n`);
        if (p.phase === 'enter_on_device') say(`\n  ▶ enter ${p.pin} on the TV when it asks.\n`);
      },
    });
    if (res.ok && res.paired) {
      rows.push([proto, 'paired', UNLOCKS[proto] ?? '']);
      if (pick.id) {
        const cfg = loadConfig();
        const d = cfg.devices[pick.id];
        if (d) { d.paired = [...new Set([...(d.paired ?? []), proto])]; saveConfig(cfg); }
      }
    } else {
      const e = explain(res.error ?? 'pairing_failed', res.detail);
      rows.push([proto, `failed: ${e.message}`, e.fix]);
      process.exitCode = 1;
      // A timed-out or refused PIN means nobody is at the screen; starting the
      // next protocol would just paint another code on the TV for no one.
      if (want.indexOf(proto) < want.length - 1) rows.push([want[want.indexOf(proto) + 1], 'skipped', `fix ${proto} first, then run pair again`]);
      break;
    }
  }
  say(table(['Protocol', 'Result', 'Unlocks / fix'], rows));
}

// ---------------------------------------------------------------------------
// alias — room names and the default
// ---------------------------------------------------------------------------
async function cmdAlias(args) {
  const cfg = loadConfig();
  const room = args._[1];
  if (!room) {
    const rows = Object.entries(cfg.devices).map(([id, d]) => [d.name, aliasesFor(cfg, id).join(', ') || '—', cfg.default === id ? 'yes' : '', d.address]);
    say(rows.length ? table(['Apple TV', 'Alias', 'Default', 'Address'], rows) : 'no devices remembered — run `appletv scan` first');
    return;
  }
  if (!args.device) throw new Fail('usage', 'alias <room> --device <name> [--default]');
  const r = resolveDevice(cfg, args.device);
  if (!r.ok) throw new Fail(r.error, r.candidates.map((c) => c.name).join(', '));
  cfg.aliases[room] = r.id;
  if (args.default || !cfg.default) cfg.default = r.id;
  saveConfig(cfg);
  say(table(['Alias', 'Apple TV', 'Default'], [[room, r.device.name, cfg.default === r.id ? 'yes' : 'no']]));
}

// ---------------------------------------------------------------------------
// state — read everything back
// ---------------------------------------------------------------------------
async function cmdState(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  say(`reading ${pick.device.name}…`);
  const res = driveDevice('state', pick, [], { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  capture(dir, 'state.json', res);
  say(stateTable(res.state));
}

// ---------------------------------------------------------------------------
// send — the one rule, live
// ---------------------------------------------------------------------------
function parseSteps(spec) {
  return String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [command, ...rest] = s.split('=');
    return { command: command.trim(), arg: rest.length ? rest.join('=').trim() : null };
  });
}

async function cmdSend(args) {
  const dir = outDir(args);
  const spec = args._.slice(1).join(',');
  if (!spec) throw new Fail('usage', 'send [--device <name>] <command[=arg][,command...]>');
  const pick = pickDevice(args);
  const steps = parseSteps(spec);
  const caps = [];
  const existing = dir ? readdirSync(dir).filter((f) => /^send-\d+\.json$/.test(f)).length : 0;
  for (const [i, step] of steps.entries()) {
    say(`sending ${step.arg ? `${step.command}=${step.arg}` : step.command} to ${pick.device.name}, then reading back…`);
    const extra = ['--tries', String(args.tries ?? 3), '--settle', String(args.settle ?? 1.5)];
    if (step.arg !== null) extra.push('--arg', step.arg);
    const res = driveDevice('press', pick, [step.command, ...extra], { debug: !!args.debug });
    if (!res.ok) throw failFrom(res);
    const cap = { ...res, verdict: verdict(res) };
    caps.push(cap);
    capture(dir, `send-${String(existing + i + 1).padStart(2, '0')}.json`, cap);
    if (cap.verdict.verdict === 'mismatch' && steps.length > 1 && !args.keepGoing) {
      say('stopping the sequence at the first mismatch (pass --keep-going to continue).');
      break;
    }
  }
  say(sendTable(caps));
  say(`\n${summarize(caps)}.`);
  if (caps.some((c) => c.verdict.verdict === 'mismatch')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// apps — what is installed, and what a name or link resolves to
// ---------------------------------------------------------------------------
async function cmdApps(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  const query = args._.slice(1).join(' ').trim();
  say(`listing apps on ${pick.device.name}…`);
  const res = driveDevice('apps', pick, [], { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  capture(dir, 'apps.json', res);
  if (!query) { say(appsTable(res)); return; }
  const q = query.toLowerCase();
  const byUrl = /^https?:\/\//i.test(query) ? launchTarget(query) : null;
  const hits = byUrl
    ? res.apps.filter((a) => a.id === byUrl)
    : res.apps.filter((a) => a.id.toLowerCase() === q || a.name.toLowerCase() === q || a.name.toLowerCase().includes(q));
  if (hits.length === 0) {
    say(table(['Query', 'Resolves to'], [[query, byUrl ? `${byUrl} (not installed on this TV)` : 'no installed app matches']]));
    process.exitCode = 1;
    return;
  }
  say(table(['Query', 'App', 'Launch target'], hits.map((a) => [query, a.name, byUrl ? query : a.id])));
}

// ---------------------------------------------------------------------------
// type — keyboard with read-back
// ---------------------------------------------------------------------------
async function cmdType(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  const text = args._.slice(1).join(' ');
  const op = args.clear ? 'clear' : args.append ? 'append' : args.get ? 'get' : 'set';
  if (op !== 'clear' && op !== 'get' && !text) throw new Fail('usage', 'type [--device <name>] <text> [--append] | --clear | --get');
  say(`${op === 'get' ? 'reading' : 'typing into'} the focused field on ${pick.device.name}…`);
  const res = driveDevice('text', pick, [op, '--text', text], { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  const cap = { ...res, verdict: textVerdict(res) };
  const existing = dir ? readdirSync(dir).filter((f) => /^type-\d+\.json$/.test(f)).length : 0;
  capture(dir, `type-${String(existing + 1).padStart(2, '0')}.json`, cap);
  say(typeTable(cap));
  if (cap.verdict.verdict === 'mismatch') process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// report — the same tables from a frozen capture, verdicts re-derived
// ---------------------------------------------------------------------------
async function cmdReport(args) {
  const from = args.from ? resolve(args.from) : null;
  if (!from || !existsSync(from)) throw new Fail('usage', 'report --from <capture dir>');
  const files = readdirSync(from).sort();
  const read = (f) => JSON.parse(readFileSync(join(from, f), 'utf8'));
  const sections = [];
  const problems = [];
  if (files.includes('scan.json')) {
    const scan = read('scan.json');
    sections.push(`## Scan (${scan.mode}, ${scan.devices.length} found)\n\n${scanTable(scan, () => [])}`);
  }
  if (files.includes('state.json')) sections.push(`## State\n\n${stateTable(read('state.json').state)}`);
  if (files.includes('apps.json')) {
    const apps = read('apps.json');
    sections.push(`## Apps (${apps.apps.length})\n\n${appsTable(apps)}`);
  }
  const sends = files.filter((f) => /^send-\d+\.json$/.test(f)).map(read);
  if (sends.length) {
    const rows = sendRows(sends);
    rows.forEach((r, i) => {
      const recorded = sends[i].verdict?.verdict;
      if (recorded && recorded !== r.v.verdict) problems.push(`send-${String(i + 1).padStart(2, '0')}: recorded verdict "${recorded}" but the code derives "${r.v.verdict}" — the verifier or the capture changed`);
      if (r.v.verdict === 'mismatch') problems.push(`send-${String(i + 1).padStart(2, '0')}: ${r.row[1]} — ${r.v.why}`);
    });
    sections.push(`## Sends (${summarize(sends)})\n\n${sendTable(sends)}`);
  }
  const types = files.filter((f) => /^type-\d+\.json$/.test(f)).map(read);
  types.forEach((t, i) => {
    const v = textVerdict(t);
    if (t.verdict?.verdict && t.verdict.verdict !== v.verdict) problems.push(`type-${String(i + 1).padStart(2, '0')}: recorded "${t.verdict.verdict}" but the code derives "${v.verdict}"`);
    if (v.verdict === 'mismatch') problems.push(`type-${String(i + 1).padStart(2, '0')}: ${v.why}`);
    sections.push(`## Keyboard\n\n${typeTable(t)}`);
  });
  if (sections.length === 0) throw new Fail('usage', `no captures in ${from} (expected scan.json, state.json, send-NN.json…)`);
  say(`# appletv run\n\n${sections.join('\n\n')}`);
  if (problems.length) {
    say(`\n## Not done\n\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
  }
}

const USAGE = `appletv v${VERSION} — find the Apple TVs on your network, pair with one, control it, and never call a command done until the TV's own state agrees.

  appletv doctor [--install|--install fresh]          python + pyatv venv + credentials + config
  appletv scan [--hosts <ip,ip>] [--timeout <s>]      every Apple TV, paired protocols, aliases
  appletv pair --device <name> [--protocol airplay|companion|all] [--force]
  appletv pair --pin <code>                            deliver the on-screen PIN to a waiting pair
  appletv alias [<room> --device <name> [--default]]  room names; no args lists them
  appletv state [--device <name>]                     power, app, playback, keyboard, volume
  appletv send [--device <name>] <cmd[=arg][,cmd…]>   send + read back → verified|mismatch|unverifiable
  appletv apps [--device <name>] [<name or url>]      installed apps; resolve a launch target
  appletv type [--device <name>] <text> [--append] | --clear | --get
  appletv report --from <dir>                         render a captured run offline

  --device accepts an alias, a name, an identifier or an IP; omit it to use the default.
  --out <dir> on any live command writes its captures there (also APPLETV_OUT).
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return say(VERSION);
  try {
    switch (cmd) {
      case 'doctor': return await cmdDoctor(args);
      case 'scan': return await cmdScan(args);
      case 'pair': return await cmdPair(args);
      case 'alias': return await cmdAlias(args);
      case 'state': return await cmdState(args);
      case 'send': return await cmdSend(args);
      case 'apps': return await cmdApps(args);
      case 'type': return await cmdType(args);
      case 'report': return await cmdReport(args);
      default:
        say(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    process.stderr.write(`appletv: ${err.message}\n`);
    process.exitCode = 1;
  }
}

main();

export { DRIVER, SKILL_DIR };
