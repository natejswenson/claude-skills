/**
 * Every table the skill prints, built from captures — never from a live
 * connection — so `report --from <dir>` renders a frozen run identically in
 * CI and in a session. Pure: no clock, no host paths.
 */
import { verdict, textVerdict } from './verify.mjs';

const KEYPRESS = new Set(['up', 'down', 'left', 'right', 'select', 'menu', 'home', 'home_hold', 'top_menu', 'channel_up', 'channel_down', 'screensaver', 'guide', 'control_center']);

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function scanTable(scan, aliasesOf = () => []) {
  const rows = (scan.devices ?? []).map((d) => [
    d.name,
    `${dash(d.model)}`,
    d.version ? `tvOS ${d.version}` : '—',
    d.address,
    (d.services ?? []).filter((s) => s.paired).map((s) => s.protocol).join('+') || 'not paired',
    (d.services ?? []).filter((s) => !s.paired && s.pairing === 'Mandatory' && ['airplay', 'companion'].includes(s.protocol)).map((s) => s.protocol).join('+') || '—',
    aliasesOf(d.identifier).join(', ') || '—',
  ]);
  return table(['Apple TV', 'Model', 'tvOS', 'Address', 'Paired', 'Needs pairing', 'Alias'], rows);
}

export function stateTable(state) {
  const p = state.playing ?? {};
  const un = state.unsupported ?? {};
  const ur = state.unread ?? {};
  const val = (key, v) => (un[key] ? `known-unsupported (${un[key]})` : ur[key] ? `not read (${ur[key].split(':')[0]})` : dash(v));
  const rows = [
    ['Power', val('power', state.power)],
    ['App', val('app', state.app ? `${state.app.name} (${state.app.id})` : null)],
    ['Playback', val('playing', p.device_state)],
    ['Title', dash(p.title)],
  ];
  if (p.series_name) rows.push(['Series', `${p.series_name}${p.season_number ? ` S${p.season_number}` : ''}${p.episode_number ? `E${p.episode_number}` : ''}`]);
  if (p.artist) rows.push(['Artist', p.artist]);
  if (p.position !== null && p.position !== undefined) rows.push(['Position', `${p.position}s${p.total_time ? ` / ${p.total_time}s` : ''}`]);
  rows.push(['Keyboard', val('focus', state.focus)]);
  rows.push(['Volume', val('volume', state.volume)]);
  return table(['Field', 'Value'], rows);
}

export function sendRows(caps) {
  return caps.map((cap, i) => {
    const v = verdict(cap);
    return { v, row: [String(i + 1), cap.arg ? `${cap.command}=${cap.arg}` : cap.command, v.before, v.after, v.verdict, v.why] };
  });
}

/** The full table — every read-back, for `report` and `--verbose`. */
export function sendTable(caps) {
  return table(['Step', 'Command', 'Before', 'After', 'Verdict', 'Why'], sendRows(caps).map((r) => r.row));
}

/** What a person reads after a send: one line per step, keypress runs collapsed, a keypress is "sent". */
export function resultOf(cap, v) {
  const label = cap.arg ? `${cap.command}=${cap.arg}` : cap.command;
  if (v.verdict === 'verified') return `verified (${v.before} → ${v.after})`;
  if (v.verdict === 'mismatch') return `mismatch — ${v.why}`;
  if (KEYPRESS.has(cap.command)) return 'sent';
  if (/^already /.test(v.why)) return v.why.replace(/ before the send.*$/, '');
  return `sent — ${v.why}`;
}

export function compactSendTable(caps) {
  const rows = [];
  let i = 0;
  while (i < caps.length) {
    const cap = caps[i];
    const v = verdict(cap);
    let j = i;
    if (KEYPRESS.has(cap.command) && v.verdict === 'unverifiable') {
      while (j + 1 < caps.length && caps[j + 1].command === cap.command && caps[j + 1].arg === cap.arg && verdict(caps[j + 1]).verdict === 'unverifiable') j += 1;
    }
    const step = j > i ? `${i + 1}–${j + 1}` : String(i + 1);
    const label = j > i ? `${cap.command} ×${j - i + 1}` : cap.arg ? `${cap.command}=${cap.arg}` : cap.command;
    rows.push([step, label, resultOf(cap, v)]);
    i = j + 1;
  }
  return table(['Step', 'Command', 'Result'], rows);
}

export function appsTable(apps, subscribed = new Set()) {
  return table(['App', 'Bundle id', 'Subscribed'], (apps.apps ?? []).map((a) => [a.name, a.id, subscribed.has(a.id) ? 'yes' : '']));
}

export function typeTable(cap) {
  const v = textVerdict(cap);
  return table(['Op', 'Focus', 'Before', 'After', 'Verdict', 'Why'], [[cap.op, cap.focus, v.before, v.after, v.verdict, v.why]]);
}

/** One line the agent can say after a send. */
export function summarize(caps) {
  const vs = sendRows(caps).map((r) => r.v.verdict);
  const n = (k) => vs.filter((x) => x === k).length;
  const parts = [];
  if (n('verified')) parts.push(`${n('verified')} verified`);
  if (n('mismatch')) parts.push(`${n('mismatch')} mismatch`);
  if (n('unverifiable')) parts.push(`${n('unverifiable')} sent without read-back`);
  return parts.join(', ') || 'nothing sent';
}
