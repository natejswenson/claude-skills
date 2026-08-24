/**
 * The one rule as code.
 *
 * A send capture holds the command, the state read before it, and the reads
 * after it. This module — and nothing else — decides whether the after state
 * AGREES with the command. It is pure so the same function runs live and
 * over a frozen capture in CI, which is how the baseline catches the verifier
 * being weakened: a recorded verdict the code no longer re-derives is a red
 * test, not a quiet drift.
 *
 * Exactly three verdicts exist:
 *   verified     — the read-back shows the effect the command names
 *   mismatch     — the read-back shows something else, or the device refused
 *   unverifiable — the command has no readable effect, or the device cannot
 *                  report the field on this tvOS. Never rounded up to done.
 */

export const VERDICTS = Object.freeze(['verified', 'mismatch', 'unverifiable']);

/** Deep-link hosts → the app they open, so a URL launch can still be verified. */
export const DEEP_LINK_APPS = Object.freeze({
  'netflix.com': 'com.netflix.Netflix',
  'www.netflix.com': 'com.netflix.Netflix',
  'disneyplus.com': 'com.disney.disneyplus',
  'www.disneyplus.com': 'com.disney.disneyplus',
  'youtube.com': 'com.google.ios.youtube',
  'www.youtube.com': 'com.google.ios.youtube',
  'youtu.be': 'com.google.ios.youtube',
  'tv.apple.com': 'com.apple.TVWatchList',
  'music.apple.com': 'com.apple.TVMusic',
  'play.hbomax.com': 'com.wbd.stream',
  'play.max.com': 'com.wbd.stream',
  'www.max.com': 'com.wbd.stream',
  'www.hulu.com': 'com.hulu.plus',
  'hulu.com': 'com.hulu.plus',
  'www.primevideo.com': 'com.amazon.aiv.AIVApp',
  'primevideo.com': 'com.amazon.aiv.AIVApp',
  'www.amazon.com': 'com.amazon.aiv.AIVApp',
  'www.peacocktv.com': 'com.peacocktv.peacock',
  'www.paramountplus.com': 'com.cbsvideo.app',
  'open.spotify.com': 'com.spotify.client',
  'app.plex.tv': 'com.plexapp.plex',
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ds = (s) => s?.playing?.device_state ?? null;
const pos = (s) => num(s?.playing?.position);
const title = (s) => s?.playing?.title ?? null;
const cid = (s) => s?.playing?.content_identifier ?? null;
const power = (s) => s?.power ?? null;
const appId = (s) => s?.app?.id ?? null;
const volume = (s) => num(s?.volume);

const KEYPRESSES = new Set([
  'up', 'down', 'left', 'right', 'select', 'menu', 'home_hold', 'top_menu',
  'channel_up', 'channel_down', 'screensaver', 'guide', 'control_center',
]);

/** Which app a launch target names, or null when nothing on disk can say. */
export function launchTarget(arg) {
  if (!arg) return null;
  if (/^[a-z0-9.-]+\.[A-Za-z0-9.-]+$/i.test(arg) && !/^https?:/i.test(arg) && !arg.includes('/')) return arg;
  try {
    const host = new URL(arg).host.toLowerCase();
    return DEEP_LINK_APPS[host] ?? null;
  } catch {
    return null;
  }
}

function fmtState(s, what) {
  if (!s) return '—';
  switch (what) {
    case 'playback': return `${ds(s) ?? '?'}${title(s) ? ` · ${title(s)}` : ''}`;
    case 'position': return pos(s) === null ? '?' : `${pos(s)}s`;
    case 'power': return power(s) ?? '?';
    case 'app': return s?.app ? `${s.app.name} (${s.app.id})` : '?';
    case 'volume': return volume(s) === null ? '?' : `${volume(s)}`;
    default: return '?';
  }
}

/**
 * Did the read-back move at all across the reads? The TV app (com.apple.TVWatchList)
 * is known to stop publishing at a skip point while the episode plays; a verdict
 * built on a number that never changed is not evidence of anything.
 */
export function frozenReadback(cap) {
  const reads = Array.isArray(cap.reads) && cap.reads.length ? cap.reads : [cap.after];
  const sig = (s) => JSON.stringify([ds(s), pos(s), title(s), power(s), appId(s), volume(s)]);
  const first = sig(cap.before);
  return reads.every((r) => sig(r) === first);
}

const TV_APP = 'com.apple.TVWatchList';

const result = (verdict, what, before, after, why, expected) => ({
  verdict,
  observes: what,
  expected: expected ?? null,
  before: fmtState(before, what),
  after: fmtState(after, what),
  why,
});

/**
 * Decide the verdict for one send capture.
 * @param {{command:string, arg?:string|null, sent:{ok:boolean,error?:string,detail?:string}, before:object, after:object}} cap
 */
export function verdict(cap) {
  const { command, arg = null, before, after } = cap;
  if (!cap.sent?.ok) {
    return result('mismatch', 'playback', before, after, `device refused the command: ${cap.sent?.error ?? 'unknown'}${cap.sent?.detail ? ` — ${cap.sent.detail}` : ''}`);
  }
  const unsupported = after?.unsupported ?? {};

  const frozen = frozenReadback(cap);
  const unread = after?.unread ?? {};
  const mismatchOrFrozen = (what, why, want) => {
    // A number that never moved is not evidence — on the TV app it is a known freeze.
    if (frozen && appId(after) === TV_APP) return result('unverifiable', what, before, after, `read-back never changed — the TV app is known to stop reporting at skip points; look at the screen`, want);
    return result('mismatch', what, before, after, why, want);
  };

  const playback = (want, label = want) => {
    if (ds(after) === null) return result('unverifiable', 'playback', before, after, unread.playing ? `playback not read (${unread.playing})` : `device does not report playback state${unsupported.playing ? ` (${unsupported.playing})` : ''}`);
    if (ds(after) === want && ds(before) === want) return result('unverifiable', 'playback', before, after, `already ${label} before the send — nothing to prove`, want);
    if (ds(after) === want) return result('verified', 'playback', before, after, `read-back is ${label}`, want);
    return mismatchOrFrozen('playback', `expected ${label}, read-back is ${ds(after)}`, want);
  };

  const powerIs = (want) => {
    const p = power(after);
    if (p === null && unread.power) return result('unverifiable', 'power', before, after, `power not read (${unread.power}) — device asleep or Companion dropped`, want);
    if (p === null || p === 'unknown') return result('unverifiable', 'power', before, after, `device does not report power state${unsupported.power ? ` (${unsupported.power})` : ''}`, want);
    if (p === want && power(before) === want) return result('unverifiable', 'power', before, after, `already ${want} before the send — nothing to prove`, want);
    if (p === want) return result('verified', 'power', before, after, `read-back is ${want}`, want);
    return result('mismatch', 'power', before, after, `expected ${want}, read-back is ${p}`, want);
  };

  switch (command) {
    case 'play': return playback('playing');
    case 'pause': return playback('paused');
    case 'stop': {
      if (ds(after) === null) return playback('stopped');
      if (['stopped', 'idle'].includes(ds(after))) {
        if (appId(after) === null || appId(after) !== appId(before)) return result('unverifiable', 'playback', before, after, 'player closed — the app left now-playing, which is more than a stop', 'stopped');
        return result('verified', 'playback', before, after, `read-back is ${ds(after)}`, 'stopped');
      }
      return mismatchOrFrozen('playback', `expected stopped, read-back is ${ds(after)}`, 'stopped');
    }
    case 'play_pause': {
      if (ds(after) === null || ds(before) === null) return result('unverifiable', 'playback', before, after, 'device does not report playback state');
      if (ds(after) !== ds(before) && ['playing', 'paused'].includes(ds(after))) return result('verified', 'playback', before, after, `toggled ${ds(before)} → ${ds(after)}`, `not ${ds(before)}`);
      return result('mismatch', 'playback', before, after, `expected a toggle from ${ds(before)}, read-back is ${ds(after)}`, `not ${ds(before)}`);
    }
    case 'next':
    case 'previous': {
      const changed = (title(after) !== title(before) && title(after) !== null) || (cid(after) !== cid(before) && cid(after) !== null);
      if (changed) return result('verified', 'playback', before, after, `title changed to ${title(after) ?? cid(after)}`, 'a different title');
      return result('unverifiable', 'playback', before, after, 'no title change observed — the app may not expose the queue');
    }
    case 'skip_forward':
    case 'skip_backward': {
      const b = pos(before); const a = pos(after);
      if (b === null || a === null) return result('unverifiable', 'position', before, after, 'device does not report position');
      const delta = a - b;
      const want = command === 'skip_forward' ? 'position moved forward' : 'position moved back';
      if (command === 'skip_forward' && delta >= 5) return result('verified', 'position', before, after, `position +${delta}s`, want);
      if (command === 'skip_backward' && delta < 0) return result('verified', 'position', before, after, `position ${delta}s`, want);
      if (frozen) return result('unverifiable', 'position', before, after, 'position never changed across the reads — stale report, look at the screen', want);
      return result('mismatch', 'position', before, after, `expected ${want}, position moved ${delta >= 0 ? '+' : ''}${delta}s`, want);
    }
    case 'set_position': {
      const a = pos(after); const want = Number(arg);
      if (a === null) return result('unverifiable', 'position', before, after, 'device does not report position');
      if (!Number.isFinite(want)) return result('mismatch', 'position', before, after, `set_position needs a number, got ${arg}`);
      if (Math.abs(a - want) <= 6) return result('verified', 'position', before, after, `position is ${a}s`, `${want}s`);
      return frozen ? result('unverifiable', 'position', before, after, 'position never changed across the reads — stale report', `${want}s`) : result('mismatch', 'position', before, after, `expected ${want}s, position is ${a}s`, `${want}s`);
    }
    case 'turn_on':
    case 'wakeup': return powerIs('on');
    case 'turn_off':
    case 'suspend': return powerIs('off');
    case 'set_volume': {
      const v = volume(after); const want = Number(arg);
      if (v === null) return result('unverifiable', 'volume', before, after, `device does not report volume${unsupported.volume ? ` (${unsupported.volume})` : ''}`);
      return Math.abs(v - want) <= 1
        ? result('verified', 'volume', before, after, `volume is ${v}`, `${want}`)
        : result('mismatch', 'volume', before, after, `expected ${want}, volume is ${v}`, `${want}`);
    }
    case 'volume_up':
    case 'volume_down': {
      const b = volume(before); const a = volume(after);
      if (b === null || a === null) return result('unverifiable', 'volume', before, after, 'device does not report volume (HDMI-CEC volume has no read-back)');
      const ok = command === 'volume_up' ? a > b : a < b;
      const want = command === 'volume_up' ? 'louder' : 'quieter';
      return ok ? result('verified', 'volume', before, after, `volume ${b} → ${a}`, want) : result('mismatch', 'volume', before, after, `expected ${want}, volume ${b} → ${a}`, want);
    }
    case 'launch_app': {
      // `app` is the now-playing OWNER reported over MRP, not the foreground
      // app: a launch to an app's home screen changes nothing until that app
      // starts playing. So "unchanged" is unknowable, not a proven failure —
      // real runs against tvOS 26.6 showed Settings and Netflix both leaving
      // `app` on the previous media app. Only a change to a *different* app
      // than the target is evidence against the launch.
      const want = launchTarget(arg);
      const a = appId(after);
      if (a === null) return result('unverifiable', 'app', before, after, `device does not report the foreground app${unsupported.app ? ` (${unsupported.app})` : ''}`, want);
      if (want && a === want && appId(before) === want) return result('unverifiable', 'app', before, after, `${after.app.name} already owned now-playing before the send — foreground unknown`, want);
      if (want && a === want) return result('verified', 'app', before, after, `now-playing owner became ${after.app.name}`, want);
      if (a === appId(before)) return result('unverifiable', 'app', before, after, 'the TV reports the now-playing app, not the foreground one — it only changes once the launched app plays something; look at the screen', want ?? 'a different app');
      if (want) return result('mismatch', 'app', before, after, `expected ${want}, now-playing owner became ${a}`, want);
      return result('verified', 'app', before, after, `now-playing owner changed to ${after.app.name}`, 'a different app');
    }
    case 'home': {
      const a = appId(after);
      if (a !== null && appId(before) !== null && a !== appId(before)) return result('verified', 'app', before, after, `left ${before.app.name}, foreground is now ${after.app.name}`, 'a different app');
      return result('unverifiable', 'app', before, after, 'a keypress has no readable state of its own');
    }
    case 'set_shuffle':
    case 'set_repeat': {
      const key = command === 'set_shuffle' ? 'shuffle' : 'repeat';
      const a = after?.playing?.[key] ?? null; const want = String(arg ?? '').toLowerCase();
      if (a === null) return result('unverifiable', 'playback', before, after, `device does not report ${key}`);
      return a === want ? result('verified', 'playback', before, after, `${key} is ${a}`, want) : result('mismatch', 'playback', before, after, `expected ${key} ${want}, read-back is ${a}`, want);
    }
    default:
      if (KEYPRESSES.has(command)) return result('unverifiable', 'playback', before, after, 'a keypress has no readable state of its own');
      return result('unverifiable', 'playback', before, after, `no read-back rule for ${command}`);
  }
}

/** Verdict for a keyboard capture (type): the field must read back what was sent. */
export function textVerdict(cap) {
  const { op, text, before, after, sent, focus } = cap;
  if (op === 'get') return after === null || after === undefined
    ? { verdict: 'unverifiable', expected: null, before: before ?? '', after: '', why: 'device did not return the field' }
    : { verdict: 'verified', expected: null, before: before ?? '', after, why: 'read only' };
  if (focus !== 'focused') return { verdict: 'mismatch', expected: text ?? '', before: before ?? '', after: after ?? '', why: 'no text field is focused on the TV' };
  if (!sent?.ok) return { verdict: 'mismatch', expected: text ?? '', before: before ?? '', after: after ?? '', why: `device refused: ${sent?.error ?? 'unknown'}` };
  const expected = op === 'set' ? text : op === 'append' ? `${before ?? ''}${text}` : '';
  if (after === null || after === undefined) return { verdict: 'unverifiable', expected, before: before ?? '', after: '', why: 'device did not return the field' };
  return after === expected
    ? { verdict: 'verified', expected, before: before ?? '', after, why: 'field reads back the text' }
    : { verdict: 'mismatch', expected, before: before ?? '', after, why: 'field reads back something else' };
}

/**
 * Verdict for `play`: the last read-back must show something PLAYING, in the
 * expected app when one is known, with the expected title when one was given.
 * This is the one Netflix action that is fully verifiable end to end.
 */
export function playVerdict(cap, { title = null, appId: wantApp = null } = {}) {
  const after = cap?.after;
  const state = ds(after);
  const got = title ? title.toLowerCase() : null;
  const t = (after?.playing?.title ?? '') || '';
  const series = (after?.playing?.series_name ?? '') || '';
  const app = appId(after);
  const where = `${state ?? '?'}${t ? ` · ${t}` : ''}${series ? ` (${series})` : ''}${app ? ` in ${after.app.name}` : ''}`;
  if (state === null) return { verdict: 'unverifiable', why: 'device does not report playback state', after: where };
  if (state !== 'playing' && app === TV_APP && frozenReadback(cap)) return { verdict: 'unverifiable', why: `read-back never changed (${where}) — the TV app stops reporting at skip points; look at the screen`, after: where };
  if (state !== 'playing') return { verdict: 'mismatch', why: `expected playing, read-back is ${where}`, after: where };
  if (wantApp && app && app !== wantApp) return { verdict: 'mismatch', why: `playing, but in ${app} rather than ${wantApp}`, after: where };
  if (got && !(t.toLowerCase().includes(got) || series.toLowerCase().includes(got))) {
    return { verdict: 'mismatch', why: `playing, but the title reads "${t || series}" not "${title}"`, after: where };
  }
  return { verdict: 'verified', why: `read-back is ${where}`, after: where };
}
