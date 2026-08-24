/**
 * Device memory: aliases ("living room" → an identifier), the default device,
 * and a cache of every device a scan has seen. Lives outside the repo so a
 * home's room names never reach a public commit.
 *
 *   ~/.config/appletv/config.json     (APPLETV_CONFIG overrides, for tests)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function configPath() {
  return process.env.APPLETV_CONFIG || join(homedir(), '.config', 'appletv', 'config.json');
}

export function loadConfig(path = configPath()) {
  if (!existsSync(path)) return { default: null, aliases: {}, devices: {}, prefs: {} };
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  return { default: cfg.default ?? null, aliases: cfg.aliases ?? {}, devices: cfg.devices ?? {}, prefs: cfg.prefs ?? {} };
}

export function saveConfig(cfg, path = configPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
  return path;
}

/** Fold a scan's devices into the cache. Returns the updated config. */
export function rememberDevices(cfg, devices, seenAt) {
  for (const d of devices) {
    cfg.devices[d.identifier] = {
      name: d.name,
      address: d.address,
      model: d.model,
      version: d.version,
      identifiers: d.all_identifiers ?? [d.identifier],
      paired: (d.services ?? []).filter((s) => s.paired).map((s) => s.protocol),
      last_seen: seenAt,
    };
  }
  return cfg;
}

export function aliasesFor(cfg, identifier) {
  return Object.entries(cfg.aliases).filter(([, id]) => id === identifier).map(([room]) => room);
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Resolve what the user said to one cached device.
 * Returns {ok:true, id, device} or {ok:false, error, candidates}.
 * Match order: alias, exact name, identifier, address, name prefix.
 */
export function resolveDevice(cfg, query) {
  const entries = Object.entries(cfg.devices);
  if (!query) {
    if (cfg.default && cfg.devices[cfg.default]) return { ok: true, id: cfg.default, device: cfg.devices[cfg.default], via: 'default' };
    if (entries.length === 1) return { ok: true, id: entries[0][0], device: entries[0][1], via: 'only device' };
    return { ok: false, error: entries.length === 0 ? 'no_device' : 'multiple_devices', candidates: entries.map(([id, d]) => ({ id, name: d.name })) };
  }
  const q = norm(query);
  const aliasHit = Object.entries(cfg.aliases).find(([room]) => norm(room) === q);
  if (aliasHit && cfg.devices[aliasHit[1]]) return { ok: true, id: aliasHit[1], device: cfg.devices[aliasHit[1]], via: `alias "${aliasHit[0]}"` };
  const byName = entries.filter(([, d]) => norm(d.name) === q);
  if (byName.length === 1) return { ok: true, id: byName[0][0], device: byName[0][1], via: 'name' };
  const byId = entries.find(([id, d]) => norm(id) === q || (d.identifiers ?? []).some((x) => norm(x) === q));
  if (byId) return { ok: true, id: byId[0], device: byId[1], via: 'identifier' };
  const byAddr = entries.find(([, d]) => d.address === query);
  if (byAddr) return { ok: true, id: byAddr[0], device: byAddr[1], via: 'address' };
  const byPrefix = entries.filter(([, d]) => norm(d.name).startsWith(q) || norm(d.name).includes(q));
  if (byPrefix.length === 1) return { ok: true, id: byPrefix[0][0], device: byPrefix[0][1], via: 'name match' };
  if (byPrefix.length > 1 || byName.length > 1) return { ok: false, error: 'multiple_devices', candidates: (byPrefix.length ? byPrefix : byName).map(([id, d]) => ({ id, name: d.name })) };
  return { ok: false, error: 'device_not_found', candidates: entries.map(([id, d]) => ({ id, name: d.name })) };
}

/**
 * Per-app preferences — the household's facts, never the repo's. Keyed by
 * bundle id: { profile: { name, position } } where position is the tile's
 * 1-based place in the app's profile picker, counted from the left.
 */
export const APP_WORDS = Object.freeze({
  netflix: 'com.netflix.Netflix',
  youtube: 'com.google.ios.youtube',
  'disney+': 'com.disney.disneyplus',
  disney: 'com.disney.disneyplus',
  'disney plus': 'com.disney.disneyplus',
  hulu: 'com.hulu.plus',
  max: 'com.wbd.stream',
  'hbo max': 'com.wbd.stream',
  'prime video': 'com.amazon.aiv.AIVApp',
  prime: 'com.amazon.aiv.AIVApp',
  'apple tv': 'com.apple.TVWatchList',
  'apple tv+': 'com.apple.TVWatchList',
  'tv': 'com.apple.TVWatchList',
  plex: 'com.plexapp.plex',
  spotify: 'com.spotify.client',
  peacock: 'com.peacocktv.peacock',
  'paramount+': 'com.cbsvideo.app',
  paramount: 'com.cbsvideo.app',
  music: 'com.apple.TVMusic',
  settings: 'com.apple.TVSettings',
  'pbs kids': 'org.pbskids.ipadplayer',
});

export function appIdFor(word, cfg = null) {
  const w = norm(word);
  if (!w) return null;
  if (w.includes('.') && !w.includes(' ')) return word;
  if (APP_WORDS[w]) return APP_WORDS[w];
  if (cfg) {
    for (const [id, p] of Object.entries(cfg.prefs ?? {})) if (norm(p.alias) === w) return id;
  }
  return null;
}

export function prefFor(cfg, appId) {
  return cfg.prefs?.[appId] ?? null;
}
