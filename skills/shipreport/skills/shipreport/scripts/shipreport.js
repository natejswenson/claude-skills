#!/usr/bin/env node
/**
 * shipreport — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { newCounts, countsTable, totalRedactions, redactDeep } from './lib/redact.mjs';
import { indexSessions, defaultTranscriptRoot } from './lib/sessions.mjs';
import { fetchAll } from './lib/github.mjs';
import { loadCorpus, saveCorpus, mergeItems, allItems, inWindow, defaultCorpusDir, resolveReceipt } from './lib/corpus.mjs';
import { rankItems } from './lib/rank.mjs';
import { checkDraft } from './lib/receipts.mjs';
import { renderHtml } from './lib/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const iso = (d) => new Date(d).toISOString();
const daysAgo = (n, now) => iso(new Date(now.getTime() - n * 86400000));

/**
 * The window is resolved from --since/--until, or from --days, or defaults to
 * the last seven days. `now` is injectable so a frozen run reproduces.
 */
function resolveWindow(args, now = new Date()) {
  const until = args.until ? iso(args.until) : iso(now);
  const since = args.since
    ? iso(args.since)
    : daysAgo(Number(args.days ?? 7), new Date(until));
  return { since, until };
}

const corpusDir = (args) => resolve(args.corpus ?? defaultCorpusDir());

// ── index ───────────────────────────────────────────────────────────────────

async function cmdIndex(args) {
  const dir = corpusDir(args);
  const corpus = loadCorpus(dir);
  const counts = newCounts();
  const now = new Date();
  const home = args.home ?? homedir();

  const first = !corpus.meta.watermark.github && !corpus.meta.watermark.sessions;
  // First pass reaches back a year; every later pass starts at the watermark.
  const backfill = daysAgo(Number(args.backfillDays ?? 365), now);
  const ghSince = args.full || first ? backfill : (corpus.meta.watermark.github ?? backfill);
  const seSince = args.full || first ? null : (corpus.meta.watermark.sessions ?? null);

  const rows = [];

  let ghAdded = 0;
  let ghTotalSeen = 0;
  if (!args.sessionsOnly) {
    const { login, items } = await fetchAll({ since: ghSince.slice(0, 10), login: args.login ?? corpus.meta.login ?? null });
    corpus.meta.login = login;
    ghTotalSeen = items.length;
    // Redaction is at ingest for BOTH sources, never one. Session digests went
    // through it from the start and GitHub items did not, which was safe only
    // for as long as nothing but a title was cached. Release and pull request
    // bodies are arbitrary prose — a pasted token in a changelog is a token
    // written to the corpus, where every later run and every model pass reads it.
    ghAdded = mergeItems(corpus.github, redactDeep(items, counts, home));
    rows.push(['github', ghSince.slice(0, 10), ghTotalSeen, ghAdded, Object.keys(corpus.github).length]);
  }

  let seAdded = 0;
  let seSeen = 0;
  if (!args.githubOnly) {
    const root = args.transcripts ?? defaultTranscriptRoot();
    const { digests, scanned } = indexSessions({ root, since: seSince, counts, home });
    seSeen = digests.length;
    seAdded = mergeItems(corpus.sessions, digests);
    rows.push(['sessions', seSince ? seSince.slice(0, 10) : 'all', `${seSeen}/${scanned}`, seAdded, Object.keys(corpus.sessions).length]);
  }

  corpus.meta.watermark = { github: iso(now), sessions: iso(now) };
  corpus.meta.indexedAt = iso(now);
  for (const [cls, n] of Object.entries(counts)) {
    corpus.meta.redactions[cls] = (corpus.meta.redactions[cls] ?? 0) + n;
  }
  saveCorpus(corpus);

  console.log(table(['Source', 'Since', 'Seen', 'New', 'Cached'], rows));
  const red = countsTable(counts);
  console.log('');
  console.log(red.length
    ? table(['Redacted', 'Count'], red)
    : table(['Redacted', 'Count'], [['(nothing matched)', 0]]));
  console.log('');
  console.log(table(['Pass', 'Corpus', 'Watermark'], [[
    first ? 'first — backfilled a year' : 'incremental — new items only',
    dir.replace(home, '~'),
    corpus.meta.watermark.github.slice(0, 19) + 'Z',
  ]]));
  if (totalRedactions(counts) === 0 && seSeen > 0) {
    console.log('\nnote: zero redactions over a non-empty scan is normal, not proof the redactor ran — see `npm test`.');
  }
}

// ── rank ────────────────────────────────────────────────────────────────────

function loadRanked(args) {
  const corpus = loadCorpus(corpusDir(args));
  const win = resolveWindow(args);
  const items = inWindow(allItems(corpus), win.since, win.until);
  // Releases are only yours when you own the repo. `--owner` extends that to an
  // org; `--all-owners` disables the filter entirely and says so in the table.
  const declared = [args.owner, corpus.meta.login].flat().filter((x) => typeof x === 'string');
  const owners = args.allOwners ? null : new Set(declared);
  const ranked = rankItems(items, {
    top: Number(args.top ?? 12),
    floor: Number(args.floor ?? 20),
    owners,
    // The whole corpus, not the window: "is this the component's first release"
    // is a question a seven-day slice cannot answer.
    history: allItems(corpus),
  });
  return { corpus, win, ranked };
}

async function cmdRank(args) {
  const { win, ranked } = loadRanked(args);
  if (ranked.ranked.length === 0) {
    throw new Error(`no items in ${win.since.slice(0, 10)}..${win.until.slice(0, 10)} — run \`shipreport index\` first, or widen --days`);
  }

  // A ranking of 500 candidates printed in full is a wall of text, and a wall
  // of text is not a report of what was decided. Show everything above the
  // line, plus the near misses that make the line legible, and count the rest.
  const near = Number(args.near ?? 5);
  // `--kind` answers "what did the sessions say" without grepping the table,
  // which would be exactly the pipeline the presentation contract forbids.
  const pool = args.kind ? ranked.ranked.filter((i) => i.kind === args.kind) : ranked.ranked;
  const shown = args.all || args.kind
    ? pool.slice(0, Number(args.limit ?? (args.all ? pool.length : 15)))
    : [...ranked.above, ...ranked.ranked.filter((i) => !i.above).slice(0, near)];
  const rows = shown.map((i, n) => [
    i.above ? String(n + 1) : '—',
    i.kind,
    (i.title ?? '').slice(0, 52),
    i.score,
    i.signals.join(' '),
    i.receipt,
  ]);
  console.log(table(['#', 'Kind', 'Item', 'Score', 'Signals', 'Receipt'], rows));
  const hidden = ranked.ranked.length - shown.length;
  if (hidden > 0) console.log(`\n${hidden} lower-scoring candidate(s) not shown — \`--all\` prints every one.`);
  console.log('');
  // Column names here are load-bearing. "Collapsed releases: 33" was read once
  // as "33 components were released" and reached a draft as a false figure —
  // it is the number *absorbed* into a series, not the number remaining.
  console.log(table(
    ['Window', 'Candidates', 'Above the line', 'Release series', 'Releases absorbed', 'Squash folded', "Others' releases dropped", 'Floor', 'Top'],
    [[
      `${win.since.slice(0, 10)} → ${win.until.slice(0, 10)}`,
      ranked.ranked.length,
      ranked.above.length,
      ranked.ranked.filter((i) => i.kind === 'release').length,
      ranked.collapsed,
      ranked.folded.length,
      ranked.foreign.length,
      ranked.floor,
      ranked.top,
    ]],
  ));

  // The line is only a finding when it means something. Say so when it does not,
  // rather than leaving the agent to notice a column of identical numbers.
  if (ranked.tie) {
    const t = ranked.tie;
    console.log(`\nthe line is a tiebreak, not a ranking: ${t.count} items score ${t.score}, of which ${t.included} made the cut and ${t.excluded} did not. Nothing separates them — treat them as one body of work, or raise \`--top\` to take all ${t.count}.`);
  }

  // Never a silent drop: name the projects whose releases were excluded, so a
  // wrong owner list is visible rather than quietly shrinking the report.
  if (ranked.foreign.length) {
    const byRepo = new Map();
    for (const f of ranked.foreign) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1);
    console.log(`\nnot yours, so not counted: ${[...byRepo].map(([r, n]) => `${r} (${n})`).join(', ')} — your commits and pull requests there are still ranked. \`--owner <org>\` to claim, \`--all-owners\` to disable.`);
  }

  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify({ window: win, above: ranked.above, all: ranked.ranked }, null, 2) + '\n');
    console.log(`\nwrote ${resolve(args.out)}`);
  }
}

// ── show ────────────────────────────────────────────────────────────────────

/**
 * Read the artifact behind a receipt, from the corpus.
 *
 * Step 4 of the flow — "read what you are about to describe" — is the step that
 * separates a real report from a plausible one, and until now the corpus held no
 * way to do it: a release's body was never cached, so the only route was
 * `gh release view` per item. The first real run therefore made three networked
 * `gh` loops and printed roughly sixteen kilobytes of changelog into the
 * conversation, in a skill whose own presentation contract forbids exactly that.
 *
 * One call, no network, and the body already redacted at ingest.
 */
async function cmdShow(args) {
  const corpus = loadCorpus(corpusDir(args));
  const receipts = args._.slice(1);
  if (receipts.length === 0) {
    throw new Error('show: name at least one receipt — e.g. `show release:owner/repo@v1.2.0` (the Receipt column of `rank`)');
  }

  const max = Number(args.chars ?? 2400);
  const missing = [];
  const found = [];
  for (const r of receipts) {
    const item = resolveReceipt(corpus, r);
    if (!item) { missing.push(r); continue; }
    found.push({ receipt: r, item });
  }

  console.log(table(['Receipt', 'Kind', 'When', 'Title'], found.map(({ receipt, item }) => [
    receipt, item.kind, String(item.at ?? '').slice(0, 10), String(item.title ?? '').slice(0, 60),
  ])));

  for (const { receipt, item } of found) {
    console.log(`\n── ${receipt} ──`);
    if (item.url) console.log(item.url);
    const body = item.kind === 'session' ? sessionBody(item) : String(item.body ?? '').trim();
    if (!body) {
      // Never silently print nothing: a body absent because the corpus predates
      // body caching reads identically to a release with an empty changelog.
      console.log(item.kind === 'release' || item.kind === 'pr'
        ? '(no body cached — re-run `shipreport index --full` to backfill bodies)'
        : '(no body for this kind of item)');
      continue;
    }
    console.log(body.length > max ? `${body.slice(0, max).trimEnd()}\n… [truncated, --chars N for more]` : body);
  }

  if (missing.length) {
    console.log('');
    console.log(`${missing.length} receipt(s) did not resolve: ${missing.join(', ')} — check the Receipt column of \`rank\`, or run \`shipreport index\`.`);
    process.exitCode = 1;
  }
}

/** A session has no body; what it has is the shape of the work done in it. */
function sessionBody(s) {
  const tools = Object.entries(s.tools ?? {}).sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([k, n]) => `${k}×${n}`).join(', ');
  const mins = s.start && s.end ? Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60000) : null;
  return [
    `project: ${s.project ?? 'unknown'}${(s.branches ?? []).length ? ` · branches: ${s.branches.join(', ')}` : ''}`,
    `${s.userTurns ?? 0} user turns · ${s.assistantTurns ?? 0} assistant turns · ${s.edits ?? 0} edits${mins === null ? '' : ` · ${mins} min`}`,
    (s.skills ?? []).length ? `skills: ${s.skills.join(', ')}` : null,
    tools ? `tools: ${tools}` : null,
    s.firstPrompt ? `\nopened with:\n${s.firstPrompt}` : null,
  ].filter(Boolean).join('\n');
}

// ── receipts ────────────────────────────────────────────────────────────────

function readDraft(args) {
  if (!args.draft) throw new Error('receipts: --draft <file.json> is required');
  const p = resolve(args.draft);
  if (!existsSync(p)) throw new Error(`receipts: no such draft — ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function cmdReceipts(args) {
  const corpus = loadCorpus(corpusDir(args));
  const draft = readDraft(args);
  const { rows, problems, proseProblems, ok } = checkDraft(draft, corpus);

  if (rows.length) console.log(table(['Claim', 'Receipt', 'Resolved'], rows));
  console.log('');
  // `Prose` is its own column because the first real run printed `Unresolved: 0`
  // beside `Verdict: REFUSED` and the table could not explain itself — two
  // different failure classes had been collapsed into one word.
  console.log(table(['Claims', 'Receipts', 'Unresolved', 'Prose', 'Verdict'], [[
    new Set(rows.map((r) => r[0])).size,
    rows.length,
    rows.filter((r) => r[2] === 'NO').length,
    proseProblems,
    ok ? 'every claim has a receipt' : 'REFUSED',
  ]]));

  if (!ok) {
    console.error('');
    for (const p of problems) console.error(`shipreport: ${p}`);
    throw new Error(`${problems.length} problem(s) — the report is not renderable until every claim resolves`);
  }
}

// ── render ──────────────────────────────────────────────────────────────────

async function cmdRender(args) {
  const corpus = loadCorpus(corpusDir(args));
  const draft = readDraft(args);

  // The gate runs again here. `receipts` passing earlier is not a promise that
  // the draft on disk right now is the one that passed.
  const { problems, ok } = checkDraft(draft, corpus);
  if (!ok) {
    for (const p of problems) console.error(`shipreport: ${p}`);
    throw new Error('render refused — a claim in this draft has no resolvable receipt');
  }

  const win = draft.window ?? resolveWindow(args);
  // Same ownership rule as `rank`, or the strip and the ranking disagree.
  const declared = [args.owner, corpus.meta.login].flat().filter((x) => typeof x === 'string');
  const owners = args.allOwners ? null : new Set(declared);
  // The strip counts the window, not the citations — see computeNumbers.
  const items = inWindow(allItems(corpus), String(win.since), String(win.until));

  const html = renderHtml({
    draft,
    corpus,
    window: win,
    items,
    cssPath: join(HERE, '..', 'assets', 'report.css'),
    stamp: args.stamp ?? 'NS',
    byline: args.byline ?? '',
    owners,
  });

  const out = resolve(args.out ?? join(process.cwd(), 'shipreport.html'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  const rows = (draft.sections ?? []).map((s) => [
    s.title,
    (s.items ?? []).length,
    (s.items ?? []).reduce((a, i) => a + (i.receipts ?? []).length, 0),
  ]);
  console.log(table(['Section', 'Items', 'Receipts'], rows));
  console.log('');
  console.log(table(['Cards', 'Bytes', 'Window'], [[
    rows.reduce((a, r) => a + r[1], 0),
    html.length,
    `${String(win.since).slice(0, 10)} → ${String(win.until).slice(0, 10)}`,
  ]]));
  // The path goes on its own line, not in a cell. A padded table column holding
  // an absolute path is both unreadable and a golden that encodes the host's
  // home directory — it passes locally and fails in CI.
  console.log(`\nwrote ${out.replace(homedir(), '~')}`);

  // The sheet is the product; the user should watch it open rather than read a
  // paragraph about it. `--no-open` exists for CI and for the frozen baseline.
  if (!args.noOpen && process.platform === 'darwin') {
    try { await promisify(execFile)('open', [out]); } catch { /* opening is a nicety, never a failure */ }
  }
}

const USAGE = `shipreport v${VERSION} — an executive summary of shipped work, where every claim carries a receipt.

  shipreport index    [--corpus <dir>] [--days N] [--full] [--github-only|--sessions-only]
  shipreport rank     [--days N | --since <date> --until <date>] [--top N] [--floor N]
                      [--kind release|pr|commit|session] [--limit N] [--near N] [--all] [--out <file>]
  shipreport show     <receipt> [<receipt>…] [--chars N]
  shipreport receipts --draft <file.json>
  shipreport render   --draft <file.json> [--out <file.html>] [--byline <text>]

Every command's output is already bounded and already a table. Run them bare —
piping through \`tail\` or \`grep\` silently eats the head of a table, and \`--kind\`
answers "what did the sessions say" without a pipeline.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'index': return await cmdIndex(args);
      case 'rank': return await cmdRank(args);
      case 'show': return await cmdShow(args);
      case 'receipts': return await cmdReceipts(args);
      case 'render': return await cmdRender(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`shipreport: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
