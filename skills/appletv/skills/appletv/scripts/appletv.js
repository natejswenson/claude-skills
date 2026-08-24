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
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { aliasesFor, appIdFor, configPath, loadConfig, prefFor, rememberDevices, resolveDevice, saveConfig } from './lib/config.mjs';
import { DRIVER, SKILL_DIR, VENV, drive, driveAsync, systemPython, venvPython } from './lib/driver.mjs';
import { explain } from './lib/errors.mjs';
import { appsTable, compactSendTable, scanTable, sendRows, sendTable, stateTable, summarize, table, typeTable } from './lib/report.mjs';
import { launchTarget, playVerdict, textVerdict, verdict } from './lib/verify.mjs';
import { spawnSync as spawnSyncOs } from 'node:child_process';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PIN_FILE = () => process.env.APPLETV_PIN_FILE || join(dirname(configPath()), 'pairing.pin');

/** The only flags that take a value; everything else is a switch, so `--keep-going up` keeps `up`. */
const VALUED_FLAGS = new Set(['device', 'out', 'hosts', 'timeout', 'protocol', 'pin', 'pinTimeout', 'settle', 'ceiling', 'tries', 'width', 'title', 'app', 'episode', 'profile', 'position', 'from', 'repo', 'install', 'text']);

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (VALUED_FLAGS.has(key) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
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

/** Someone is watching: refuse anything that would change what is on the screen. */
function refuseIfOnHold(cmd) {
  if (loadConfig().hold) throw new Fail('on_hold', `refused ${cmd}`);
}

/** Retry once on a dropped connection — Companion drops are transient on tvOS 26. */
function driveDeviceRetry(sub, pick, extra = [], opts = {}) {
  let res = driveDevice(sub, pick, extra, opts);
  if (!res.ok && ['connection_failed', 'timeout'].includes(res.error)) {
    spawnSyncOs('sleep', ['2']);
    res = driveDevice(sub, pick, extra, opts);
  }
  return res;
}

// ---------------------------------------------------------------------------
// doctor — is the machine able to talk to an Apple TV at all
// ---------------------------------------------------------------------------
function credentialCount(storagePath) {
  try {
    const j = JSON.parse(readFileSync(storagePath, 'utf8'));
    const devices = j.devices ?? j;
    let n = 0;
    for (const d of Array.isArray(devices) ? devices : Object.values(devices)) {
      const protos = d.protocols ?? {};
      if (Object.values(protos).some((p) => p && p.credentials)) n += 1;
    }
    return n;
  } catch { return 0; }
}

async function cmdDoctor(args) {
  const rows = [];
  const fixes = [];
  const sys = systemPython();
  if (!sys) throw new Fail('no_python');
  let py = venvPython();
  if (!py || args.install) {
    if (!py || args.install === 'fresh') {
      say(py ? 'recreating the skill venv…' : 'creating the skill venv and installing pyatv (about a minute)…');
      if (py) rmSync(VENV, { recursive: true, force: true });
      const mk = spawnSync(sys.bin, ['-m', 'venv', VENV], { encoding: 'utf8' });
      if (mk.status !== 0) throw new Fail('no_python', mk.stderr.trim());
    } else say('upgrading pyatv in the skill venv…');
    const pip = spawnSync(join(VENV, 'bin', 'pip'), ['install', '-q', '--upgrade', 'pyatv', 'pymobiledevice3'], { encoding: 'utf8', timeout: 600_000 });
    if (pip.status !== 0) throw new Fail('no_pyatv', pip.stderr.trim().split('\n').pop());
    py = venvPython();
  }
  const d = drive('doctor');
  if (!d.ok) { say(table(['Check', 'Status'], [['pyatv', 'missing']])); throw failFrom(d); }
  rows.push(['pyatv', `${d.pyatv} (python ${d.python})`]);
  const creds = credentialCount(d.storage);
  const cfg = loadConfig();
  const pm = existsSync(join(VENV, 'bin', 'pymobiledevice3'));
  const tun = pm ? tunnelUp() : { up: false, devices: [] };
  const eyes = !pm ? 'no screenshots' : tun.up ? (tun.devices.length ? 'screenshots ok' : 'tunnel up, not developer-paired') : 'screenshots off (tunnel down)';
  const devices = Object.entries(cfg.devices);
  if (devices.length === 0) {
    rows.push(['devices', 'none yet']);
    fixes.push('run `appletv scan`');
  }
  for (const [id, dev] of devices) {
    const bits = [dev.paired?.length ? `paired (${dev.paired.join('+')})` : 'NOT paired', cfg.default === id ? 'default' : null, aliasesFor(cfg, id).join(', ') || null].filter(Boolean);
    rows.push([dev.name, bits.join(', ')]);
    if (!dev.paired?.length) fixes.push(`\`appletv pair --device "${dev.name}"\``);
  }
  rows.push(['eyes', eyes]);
  if (pm && !tun.up) fixes.push(`start the tunnel: ${TUNNELD_CMD}`);
  if (pm && tun.up && !tun.devices.length) fixes.push('`appletv screen --pair` with the TV on Remote App and Devices');
  rows.push(['services', (cfg.services ?? []).map((x) => x.word).join(', ') || 'none declared']);
  if (!(cfg.services ?? []).length) fixes.push('`appletv pref services "netflix, disney+"`');
  if (cfg.hold) rows.push(['hold', 'ON — someone is watching; only pause/state allowed']);
  if (creds === 0 && devices.length) fixes.push('no credentials stored yet');
  say(table(['Check', 'Status'], rows));
  if (fixes.length) say(`\nto do: ${fixes.join('; ')}`);
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
    const ssid = (() => { const r = spawnSync('ipconfig', ['getsummary', 'en0'], { encoding: 'utf8' }); return r.stdout?.match(/\bSSID : (.+)/)?.[1]?.trim() ?? null; })();
    say(`\n${e.message} after ${res.seconds}s (${res.mode}${ssid ? `; this Mac is on Wi-Fi "${ssid}"` : ''}${res.ignored.length ? `; ignored ${res.ignored.join(', ')} — not a TV` : ''}).\n  fix: ${e.fix}`);
    process.exitCode = 1;
    return;
  }
  say(scanTable(res, (id) => aliasesFor(cfg, id)));
  if (res.ignored?.length) say(`(not Apple TVs, ignored: ${res.ignored.join(', ')})`);
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
  if (pick.device.model && !/apple tv/i.test(pick.device.model) && !pick.device.version) throw new Fail('not_an_apple_tv', pick.device.name);
  const want = args.protocol && args.protocol !== 'all' ? [String(args.protocol).toLowerCase()] : ['airplay', 'companion'];
  const already = new Set(pick.device.paired ?? []);
  const rows = [];
  if (want.some((w) => !already.has(w) || args.force)) say(`stand in front of ${pick.device.name}: it will show a 4-digit code for each protocol (${want.filter((w) => !already.has(w) || args.force).join(', then ')}) as soon as pairing starts.`);
  for (const proto of want) {
    if (already.has(proto) && !args.force) { rows.push([proto, 'already paired', UNLOCKS[proto] ?? '']); continue; }
    const pinFile = PIN_FILE();
    rmSync(pinFile, { force: true });
    const dargs = [...deviceArgs(pick), '--protocol', proto, '--pin-file', pinFile, '--pin-timeout', String(args.pinTimeout ?? 600)];
    if (args.pin) dargs.push('--pin', String(args.pin));
    say(`pairing ${proto} with ${pick.device.name}…`);
    const res = await driveAsync('pair', dargs, {
      debug: !!args.debug,
      onPhase: (p) => {
        if (p.phase === 'pin_needed') say(`\n  ▶ ${pick.device.name} is showing the ${proto} code NOW (4 digits, ${Math.round(Number(args.pinTimeout ?? 600) / 60)}-minute window)\n`);
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
  const res = driveDeviceRetry('state', pick, [], { debug: !!args.debug });
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

const KEYPRESSES = new Set(['up', 'down', 'left', 'right', 'select', 'menu', 'home_hold', 'top_menu', 'channel_up', 'channel_down', 'screensaver', 'guide', 'control_center']);
/** How long the read-back may wait for each command's field to move (it stops as soon as it does). */
const CEILING = { turn_on: 6, turn_off: 6, suspend: 6, wakeup: 6, launch_app: 5, home: 3, set_volume: 3, volume_up: 3, volume_down: 3 };
const ceilingFor = (command, override) => (override !== undefined ? Number(override) : KEYPRESSES.has(command) ? 0 : CEILING[command] ?? 4);

const SAFE_WHILE_WATCHING = new Set(['pause', 'volume_up', 'volume_down', 'set_volume', 'play']);

/** One driver connection for the whole sequence; per-step ceilings; captures written as before. */
function pressSequence(pick, steps, { dir = null, debug = false, ceiling, stopOnRefusal = true } = {}) {
  const payload = steps.map((st) => ({ command: st.command, arg: st.arg ?? null, ceiling: ceilingFor(st.command, ceiling) }));
  const extra = ['--steps', JSON.stringify(payload)];
  if (stopOnRefusal) extra.push('--stop-on-refusal');
  const res = driveDeviceRetry('press', pick, extra, { debug });
  if (!res.ok) throw failFrom(res);
  const caps = (res.captures ?? [res]).map((c) => ({ ...c, verdict: verdict(c) }));
  const existing = dir ? readdirSync(dir).filter((f) => /^send-\d+\.json$/.test(f)).length : 0;
  caps.forEach((cap, i) => capture(dir, `send-${String(existing + i + 1).padStart(2, '0')}.json`, cap));
  return caps;
}

async function runSteps(pick, steps, opts = {}) {
  return pressSequence(pick, steps, opts);
}

async function cmdSend(args) {
  const dir = outDir(args);
  const spec = args._.slice(1).join(',');
  if (!spec) throw new Fail('usage', 'send [--device <name>] <command[=arg][,command...]>');
  const pick = pickDevice(args);
  const steps = parseSteps(spec);
  if (!steps.every((st) => SAFE_WHILE_WATCHING.has(st.command))) refuseIfOnHold(`send ${spec}`);
  say(`${steps.length === 1 ? (steps[0].arg ? `${steps[0].command}=${steps[0].arg}` : steps[0].command) : `${steps.length} steps`} → ${pick.device.name}…`);
  let caps;
  if (args.keepGoing) caps = pressSequence(pick, steps, { dir, debug: !!args.debug, ceiling: args.ceiling ?? args.settle, stopOnRefusal: false });
  else {
    // stop at the first mismatch: send one at a time only when a verdict could stop us
    caps = [];
    for (const step of steps) {
      caps.push(...pressSequence(pick, [step], { dir, debug: !!args.debug, ceiling: args.ceiling ?? args.settle }));
      if (caps[caps.length - 1].verdict.verdict === 'mismatch' && steps.length > 1) { say('stopped at the first mismatch (pass --keep-going to continue).'); break; }
    }
  }
  say(args.verbose ? sendTable(caps) : compactSendTable(caps));
  if (caps.some((c) => c.verdict.verdict === 'mismatch')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// pref — the household's preferences, on this Mac only
// ---------------------------------------------------------------------------
async function cmdPref(args) {
  const cfg = loadConfig();
  const word = args._[1];
  if (word === 'hold') {
    const v = String(args._[2] ?? '').toLowerCase();
    if (v === 'on' || v === 'off') { cfg.hold = v === 'on'; saveConfig(cfg); }
    say(table(['Hold', 'Meaning'], [[cfg.hold ? 'on' : 'off', cfg.hold ? 'someone is watching — only pause, volume and state are allowed' : 'free to drive']]));
    return;
  }
  if (word === 'services') {
    const list = args._.slice(2).join(' ').split(',').map((w) => w.trim()).filter(Boolean);
    if (list.length) {
      const ids = list.map((w) => [w, appIdFor(w, cfg)]);
      const bad = ids.filter(([, id]) => !id).map(([w]) => w);
      if (bad.length) throw new Fail('usage', `not a known app word: ${bad.join(', ')} — use a bundle id from \`appletv apps\``);
      cfg.services = ids.map(([w, id]) => ({ word: w.toLowerCase(), id }));
      saveConfig(cfg);
    }
    const rows = (cfg.services ?? []).map((s) => [s.word, s.id]);
    say(rows.length ? table(['Service', 'App'], rows) : 'no services declared — e.g. appletv pref services "netflix, disney+, apple tv, paramount+"');
    return;
  }
  if (!word) {
    const rows = Object.entries(cfg.prefs).map(([id, p]) => [p.alias ?? '—', id, p.profile ? `${p.profile.name} (tile ${p.profile.position})` : '—']);
    say(rows.length ? table(['Word', 'App', 'Profile'], rows) : `no preferences yet — e.g. appletv pref netflix --profile Nathaniel --position 1\n(stored in ${configPath().replace(homedir(), '~')}, never in the repo)`);
    return;
  }
  const id = appIdFor(word, cfg);
  if (!id) throw new Fail('usage', `"${word}" is not a known app word or bundle id — pass the bundle id from \`appletv apps\``);
  const pref = cfg.prefs[id] ?? {};
  pref.alias = pref.alias ?? String(word).toLowerCase();
  if (args.profile) pref.profile = { name: String(args.profile), position: Number(args.position ?? 1) };
  if (args.forget) delete cfg.prefs[id]; else cfg.prefs[id] = pref;
  saveConfig(cfg);
  say(table(['Word', 'App', 'Profile'], [[pref.alias, id, pref.profile ? `${pref.profile.name} (tile ${pref.profile.position})` : '—']]));
}

/** The keypresses that pick the preferred profile tile, counted from the left. */
function profileSteps(pref) {
  if (!pref?.profile) return [];
  const n = Math.max(1, Number(pref.profile.position) || 1);
  return [...Array(n - 1).fill({ command: 'right', arg: null }), { command: 'select', arg: null }];
}

// ---------------------------------------------------------------------------
// open — launch an app and land on the preferred profile
// ---------------------------------------------------------------------------
async function cmdOpen(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  refuseIfOnHold('open');
  const word = args._.slice(1).join(' ');
  const cfg = loadConfig();
  const id = appIdFor(word, cfg);
  if (!id) throw new Fail('usage', `open <app word or bundle id> — "${word}" is not one I know; \`appletv apps ${word}\` finds the id`);
  const pref = prefFor(cfg, id);
  say(`opening ${word} on ${pick.device.name}…`);
  const caps = await runSteps(pick, [{ command: 'turn_on', arg: null }, { command: 'launch_app', arg: id }], { debug: !!args.debug, dir });
  const eyes = tunnelUp();
  if (eyes.up && eyes.devices.length && !args.noScreen) {
    // Look instead of pressing the profile tile blind — the picker may be tvOS's, the app's, or absent.
    const png = await cmdScreen({ ...args, _: ['screen'] });
    say(compactSendTable(caps));
    say(`\nlook at ${png}: pick ${pref?.profile ? `${pref.profile.name} (tile ${pref.profile.position})` : 'the profile'} only if a picker is showing.`);
    return;
  }
  if (pref?.profile && !args.noProfile) caps.push(...await runSteps(pick, profileSteps(pref), { debug: !!args.debug, dir, ceiling: 1 }));
  say(compactSendTable(caps));
  say(`\n${summarize(caps)}.${pref?.profile ? ` Profile tile ${pref.profile.position} (${pref.profile.name}) pressed without eyes — confirm on the screen.` : ''}`);
}

// ---------------------------------------------------------------------------
// play — a title by deep link, for the services that honour one (YouTube,
// Disney+, Apple TV+, Hulu, Peacock). Netflix killed deep links on tvOS in
// Sept 2025; for it — and anything else without a link — the agent navigates
// with `screen` between presses (look → press → look), never a recorded
// sequence replayed blind. The end state is still read back here.
// ---------------------------------------------------------------------------
async function cmdPlay(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  const cfg = loadConfig();
  const target = args._[1] ?? null;
  if (!target || !/^https?:\/\/|^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    throw new Fail('usage', 'play <deep link> [--title "<expected>"] — for an app without working deep links (Netflix), navigate with `appletv screen` between presses and confirm with `appletv state`');
  }
  const id = args.app ? appIdFor(args.app, cfg) : launchTarget(target);
  if (id === 'com.netflix.Netflix') throw new Fail('deep_link_unsupported', 'netflix');
  refuseIfOnHold('play');
  const title = args.title ? String(args.title) : null;
  const opts = { debug: !!args.debug, dir, ceiling: Number(args.ceiling ?? 8) };
  say(`playing ${title ?? target} on ${pick.device.name} via deep link…`);
  const caps = await runSteps(pick, [{ command: 'turn_on', arg: null }, { command: 'launch_app', arg: target }], opts);
  let end = caps[caps.length - 1];
  let played = playVerdict(end, { title, appId: id });
  const deadline = Date.now() + 12_000;
  while (played.verdict !== 'verified' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = driveDevice('state', pick, [], { debug: opts.debug });
    if (res.ok) { end = { ...end, after: res.state, reads: [...(end.reads ?? []), res.state] }; played = playVerdict(end, { title, appId: id }); }
  }
  say(args.verbose ? sendTable(caps) : compactSendTable(caps));
  say(`\n${played.verdict}: ${played.why}`);
  if (played.verdict !== 'verified') process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// screen — a screenshot, the one read-back that sees what a keypress did.
// pymobiledevice3 DVT over a RemoteXPC tunnel (tvOS 17+). The tunnel needs
// root, so the user starts it; the skill only checks for it and names the fix.
// ---------------------------------------------------------------------------
const PMD3 = () => join(VENV, 'bin', 'pymobiledevice3');
const TUNNELD_CMD = 'sudo ' + join(VENV, 'bin', 'pymobiledevice3') + ' remote tunneld --no-usb --no-usbmux --no-mobdev2 --wifi';

/** sudo needs a TTY the agent never has: open Terminal.app with the line typed in, password to be entered there. */
function openTerminalWith(cmd) {
  // AppleScript string literal: backslashes first, then quotes — in that order, or a
  // backslash before a quote survives as an escape and breaks out of the literal.
  const lit = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const r = spawnSync('osascript', ['-e', `tell application "Terminal"\nactivate\ndo script "${lit}"\nend tell`], { encoding: 'utf8' });
  return r.status === 0;
}

function tunnelUp() {
  const r = spawnSync('curl', ['-s', '-m', '2', 'http://127.0.0.1:49151/'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return { up: false, devices: [] };
  try {
    const j = JSON.parse(r.stdout);
    const devices = Object.keys(j);
    return { up: true, devices };
  } catch { return { up: true, devices: [] }; }
}

const PAIR_SCRIPT = `
import asyncio, json, sys
from pymobiledevice3.bonjour import browse_remotepairing_manual_pairing
from pymobiledevice3.exceptions import RemotePairingCompletedError
from pymobiledevice3.remote.tunnel_service import RemotePairingManualPairingService
want = sys.argv[1] if len(sys.argv) > 1 else None
async def m():
    found = []
    for a in await browse_remotepairing_manual_pairing():
        name = a.properties["name"]
        if want and name != want: continue
        v4 = [x.full_ip for x in a.addresses if ":" not in x.full_ip]
        if v4: found.append((name, v4[0], a.port, a.properties["identifier"]))
    if not found:
        print(json.dumps({"ok": False, "error": "not_advertising"})); return
    name, ip, port, ident = found[0]
    print(json.dumps({"phase": "pin_needed", "device": name}), file=sys.stderr, flush=True)
    try:
        async with RemotePairingManualPairingService(ident, ip, port) as svc:
            await svc.connect(autopair=True)
    except RemotePairingCompletedError:
        pass
    print(json.dumps({"ok": True, "device": name, "identifier": ident}))
asyncio.run(m())
`;

async function screenPair(args) {
  const py = venvPython();
  if (!py || !existsSync(PMD3())) throw new Fail('no_pyatv', 'pymobiledevice3 missing — run `appletv doctor --install`');
  const pinFile = PIN_FILE();
  rmSync(pinFile, { force: true });
  say('looking for an Apple TV on its "Remote App and Devices" screen…');
  const script = join(process.env.TMPDIR || '/tmp', 'appletv-devpair.py');
  writeFileSync(script, PAIR_SCRIPT);
  const child = spawn(py, [script, ...(args.device && !/^\d/.test(args.device) ? [String(args.device)] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let pinSent = false;
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => {
    for (const line of String(d).split('\n').filter(Boolean)) {
      let p = null; try { p = JSON.parse(line); } catch { if (args.debug) process.stderr.write(`${line}\n`); }
      if (p?.phase === 'pin_needed') say(`\n  ▶ ${p.device} is showing the 6-digit developer code NOW (${Math.round(Number(args.pinTimeout ?? 300) / 60)}-minute window)\n`);
    }
  });
  const deadline = Date.now() + Number(args.pinTimeout ?? 300) * 1000;
  const result = await new Promise((resolvePromise) => {
    child.on('close', () => resolvePromise(out));
    const tick = setInterval(() => {
      if (!pinSent && existsSync(pinFile)) {
        const pin = readFileSync(pinFile, 'utf8').trim();
        rmSync(pinFile, { force: true });
        if (pin) { child.stdin.write(`${pin}\n`); pinSent = true; }
      }
      if (Date.now() > deadline) { clearInterval(tick); child.kill(); resolvePromise(out); }
    }, 500);
    child.on('close', () => clearInterval(tick));
  });
  const last = result.trim().split('\n').pop() || '';
  let parsed = null; try { parsed = JSON.parse(last); } catch { parsed = null; }
  if (!parsed?.ok) throw new Fail(parsed?.error === 'not_advertising' ? 'not_advertising' : 'pairing_failed', parsed?.error === 'not_advertising' ? null : (last || 'no PIN delivered in time'));
  say(table(['Developer pairing', 'Result'], [[parsed.device, 'paired — record in ~/.pymobiledevice3']]));
}

function installTunnel() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.natjswenson.appletv.tunneld</string>
  <key>ProgramArguments</key><array>
    <string>${PMD3()}</string><string>remote</string><string>tunneld</string>
    <string>--no-usb</string><string>--no-usbmux</string><string>--no-mobdev2</string><string>--wifi</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/appletv-tunneld.log</string>
  <key>StandardErrorPath</key><string>/tmp/appletv-tunneld.log</string>
</dict></plist>
`;
  const out = join(process.env.TMPDIR || '/tmp', 'com.natjswenson.appletv.tunneld.plist');
  writeFileSync(out, plist);
  const line = `sudo cp ${out} /Library/LaunchDaemons/ && sudo launchctl bootstrap system /Library/LaunchDaemons/com.natjswenson.appletv.tunneld.plist`;
  const opened = openTerminalWith(line);
  say(table(['LaunchDaemon', 'Status'], [['com.natjswenson.appletv.tunneld', opened ? 'a Terminal window is asking for your password — that installs it; the tunnel is then up at every login' : `run once in a terminal: ${line}`]]));
}

const SCREEN_DIR = () => join(process.env.TMPDIR || '/tmp', 'appletv-screens');
const KEEP_SCREENS = 3;

/** Screenshots are a household's TV, not an artifact: keep only the last few, wipe on demand. */
function pruneScreens(keep = KEEP_SCREENS) {
  const d = SCREEN_DIR();
  if (!existsSync(d)) return 0;
  const files = readdirSync(d).filter((f) => f.endsWith('.png')).sort();
  const doomed = keep === 0 ? files : files.slice(0, Math.max(0, files.length - keep));
  for (const f of doomed) rmSync(join(d, f), { force: true });
  return doomed.length;
}

async function cmdScreen(args) {
  if (args.pair) return screenPair(args);
  if (args.installTunnel) return installTunnel();
  if (args.clean) {
    const n = pruneScreens(0);
    say(table(['Screenshots', 'Removed'], [[SCREEN_DIR().replace(homedir(), '~'), String(n)]]));
    return;
  }
  const dir = outDir(args);
  if (!existsSync(PMD3())) throw new Fail('no_pyatv', 'pymobiledevice3 is not in the skill venv — run `appletv doctor --install`');
  const t = tunnelUp();
  if (!t.up) {
    if (!args.noTerminal) openTerminalWith(TUNNELD_CMD);
    throw new Fail('no_tunnel');
  }
  if (t.devices.length === 0) throw new Fail('no_dev_pairing');
  mkdirSync(SCREEN_DIR(), { recursive: true });
  const out = resolve(args.out ? join(dir, `screen-${Date.now()}.png`) : join(SCREEN_DIR(), `${Date.now()}.png`));
  say('capturing the screen…');
  const started = Date.now();
  const r = spawnSync(PMD3(), ['developer', 'dvt', 'screenshot', out, '--tunnel', ''], { encoding: 'utf8', timeout: 45_000 });
  if (r.status !== 0 || !existsSync(out)) throw new Fail('screen_failed', (r.stderr || r.stdout || '').trim().split('\n').pop());
  const width = String(args.width ?? 960);
  spawnSync('sips', ['--resampleWidth', width, out], { encoding: 'utf8' });
  if (!args.out) pruneScreens();
  say(table(['Screenshot', 'Took', 'Width'], [[out, `${((Date.now() - started) / 1000).toFixed(1)}s`, `${width}px`]]));
  return out;
}

// ---------------------------------------------------------------------------
// apps — what is installed, and what a name or link resolves to
// ---------------------------------------------------------------------------
async function cmdApps(args) {
  const dir = outDir(args);
  const pick = pickDevice(args);
  const query = args._.slice(1).join(' ').trim();
  say(`listing apps on ${pick.device.name}…`);
  const res = driveDeviceRetry('apps', pick, [], { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  capture(dir, 'apps.json', res);
  { const cfg = loadConfig(); cfg.installed = Object.fromEntries(res.apps.map((a) => [a.id, a.name])); saveConfig(cfg); }
  if (!query) { say(appsTable(res, new Set((loadConfig().services ?? []).map((x) => x.id)))); return; }
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
  if (op !== 'get') refuseIfOnHold('type');
  const res = driveDeviceRetry('text', pick, [op, '--text', text], { debug: !!args.debug });
  if (!res.ok) throw failFrom(res);
  const cap = { ...res, verdict: textVerdict(res) };
  if (args.submit && cap.verdict.verdict === 'verified') pressSequence(pick, [{ command: 'select', arg: null }], { dir, debug: !!args.debug });
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
  appletv pref [<app word> --profile <name> --position <n>]   this household's profile per app (local only)
  appletv pref hold on|off                             someone is watching: only pause/volume/state allowed
  (send/open/play print a compact table; --verbose shows every read-back)
  appletv open [--device <name>] <app word>            turn on, launch, land on the preferred profile
  appletv play [--device <name>] <deep link> [--title "<expected>"]   services that honour deep links, verified by read-back
  appletv screen [--width 1280]                        screenshot via the developer tunnel (Read the PNG)
  appletv screen --pair [--device <name>]              one-time developer pairing (TV on Remote App and Devices)
  appletv screen --install-tunnel                      write a LaunchDaemon so the tunnel is up at login
  appletv screen --clean                               delete every kept screenshot (only the last 3 are ever kept)
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
      case 'pref': return await cmdPref(args);
      case 'open': return await cmdOpen(args);
      case 'play': return await cmdPlay(args);
      case 'screen': return await cmdScreen(args);
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
