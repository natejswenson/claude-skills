/**
 * Classify each plugin, then render. The report IS the product here, so its
 * shape is frozen byte-for-byte in the baseline eval — a changed column or a
 * reworded footer is a behaviour change, not a cosmetic one.
 */

/** Action precedence, worst first. `error` must never be outranked. */
export const ACTIONS = ['error', 'install', 'update', 'orphan', 'disabled', 'ok'];

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

/**
 * Diff the catalogue against what is installed.
 *
 * Version drift outranks `disabled` on purpose: a disabled plugin that is also
 * out of date still needs updating, and reporting only "disabled" would hide
 * the drift until someone re-enabled it and wondered why it was old.
 */
export function classify({ marketplace, catalog, installed }) {
  const rows = [];
  const seen = new Set();

  for (const entry of catalog.plugins) {
    const id = `${entry.name}@${marketplace.name}`;
    seen.add(id);
    const have = installed.get(id);
    const row = {
      plugin: entry.name,
      installed: have?.version || null,
      available: entry.available,
      enabled: have ? have.enabled : null,
      note: entry.error,
    };
    if (entry.error) row.action = 'error';
    else if (!have) row.action = 'install';
    else if (have.version !== entry.available) row.action = 'update';
    else if (!have.enabled) row.action = 'disabled';
    else row.action = 'ok';
    rows.push(row);
  }

  // Installed from this marketplace but no longer offered by it. Left alone,
  // never auto-removed — uninstalling something the user still uses is not a
  // decision a refresh gets to make.
  for (const [id, have] of installed) {
    if (have.marketplace !== marketplace.name || seen.has(id)) continue;
    rows.push({
      plugin: have.name,
      installed: have.version,
      available: null,
      enabled: have.enabled,
      action: 'orphan',
      note: 'installed but no longer in the marketplace',
    });
  }

  rows.sort((a, b) => a.plugin.localeCompare(b.plugin));
  return rows;
}

export const changeable = (rows) => rows.filter((r) => r.action === 'install' || r.action === 'update');
export const errored = (rows) => rows.filter((r) => r.action === 'error');

const dash = (v) => (v == null || v === '' ? '—' : v);

/**
 * Render a `check` report.
 *
 * The footer always separates "on disk" from "live". Collapsing them is the one
 * rule's failure mode: every command in this flow exits 0 whether or not
 * anything moved, so "updated" without "restart" reads as done when it is not.
 */
export function renderCheck({ marketplace, rows, shadows }) {
  const out = [`marketplace  ${marketplace.name} → ${marketplace.spec} (${marketplace.kind})`, ''];
  out.push(
    table(
      ['Plugin', 'Installed', 'Available', 'Action'],
      rows.map((r) => [r.plugin, dash(r.installed), dash(r.available), r.action]),
    ) || '(no plugins in this marketplace)',
  );

  const bad = errored(rows);
  if (bad.length) {
    out.push('', ...bad.map((r) => `error  ${r.plugin}: ${r.note}`));
  }
  if (shadows.length) {
    out.push('', ...shadows.map((s) => `shadowed  ${s.name}: ${s.path} wins over the plugin`));
  }

  // An unreadable source must never be summarised as "everything matches" —
  // that row is a question mark, not a pass, and the count below it would be
  // counting plugins the tool could not actually read.
  const n = changeable(rows).length;
  out.push('');
  if (bad.length) {
    out.push(`${bad.length} unreadable · ${n} to change · fix the source before trusting this table`);
  } else {
    out.push(
      n === 0
        ? `nothing to change · ${rows.length} plugins match the marketplace`
        : `${n} to change · run apply, then restart Claude Code`,
    );
  }
  return out.join('\n');
}

/**
 * Render an `apply` report. `stalled` is the load-bearing outcome: the CLI
 * exited 0 and the version on disk did not move.
 */
export function renderApply({ marketplace, rows, shadows, selfUpdated }) {
  const out = [`marketplace  ${marketplace.name} → ${marketplace.spec} (${marketplace.kind})`, ''];
  out.push(
    table(
      ['Plugin', 'Was', 'Now', 'Outcome'],
      rows.map((r) => [r.plugin, dash(r.was), dash(r.now), r.outcome]),
    ) || '(nothing to do)',
  );

  const bad = rows.filter((r) => r.outcome === 'failed' || r.outcome === 'stalled');
  if (bad.length) out.push('', ...bad.map((r) => `${r.outcome}  ${r.plugin}: ${r.note}`));
  if (shadows.length) {
    out.push('', ...shadows.map((s) => `shadowed  ${s.name}: ${s.path} wins over the plugin`));
  }
  if (selfUpdated) {
    out.push('', 'note  pluginsync updated itself — this run used the copy loaded before it changed');
  }

  const moved = rows.filter((r) => r.outcome === 'installed' || r.outcome === 'updated').length;
  out.push('');
  out.push(
    moved === 0
      ? 'nothing changed on disk'
      : `${moved} changed on disk · not live until Claude Code restarts`,
  );
  return out.join('\n');
}
