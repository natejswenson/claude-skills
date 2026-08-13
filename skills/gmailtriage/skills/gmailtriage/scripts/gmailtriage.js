#!/usr/bin/env node
/**
 * gmailtriage — the deterministic half of the skill.
 *
 * The Gmail MCP is agent-side, so this binary never touches a mailbox. The
 * agent fetches threads and the agent trashes them; everything that must not
 * depend on a model behaving well lives here — which threads a rule takes,
 * whether a thread was authorised, and what was actually moved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { validateRuleSet, validateRule, toGmailQuery, reconcileDestinations, SYSTEM_LABELS, RuleProblem, normaliseLabel, DEFAULT_SCOPE, lintRuleSet } from './lib/rules.mjs';
import { propose, candidateToRule, candidateToSortRule, subdivide, clusterToSubRule, audit, mergeLabels, mergeReceiptEntries, plan, authorise, buildReceipt, undoPlan, NotAuthorised, isSentOnly } from './lib/plan.mjs';
import { normalizeSearchThreads, threadIds, mergeThreadSources, applyCategories, validateIngest, normalizeLabels } from './lib/ingest.mjs';

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
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (c) => `| ${c.map((x, i) => String(x ?? '').padEnd(w[i])).join(' | ')} |`;
  return [line(headers), `|${w.map((x) => '-'.repeat(x + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const readJson = (p, what) => {
  const f = resolve(p);
  if (!existsSync(f)) throw new Error(`${what}: no such file — ${f}`);
  return JSON.parse(readFileSync(f, 'utf8'));
};

const STATE_DIR = join(homedir(), '.gmailtriage');
const RECEIPTS_DIR = join(STATE_DIR, 'receipts');

/** The git repository containing `start`, if any. Worktrees keep a `.git` FILE, so existence is the test, not is-directory. */
const repoRootOf = (start) => {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
};

/**
 * Every file this skill writes is somebody's mailbox — senders, subjects, the
 * shape of a life — and a git working tree is one `git add` away from a public
 * repo. A real run once wrote its thread snapshot into this skill's own
 * checkout, and the cleanup deleted the run's receipt along with it. So the
 * refusal lives at the one choke point every write goes through. The skill's
 * own state dir is exempt — it lives under $HOME on purpose, and a home
 * directory that happens to be a dotfiles repo must not brick the rule file.
 */
const writeJson = (p, v, { allowRepo = false } = {}) => {
  const f = resolve(p);
  if (!allowRepo && !(f + sep).startsWith(STATE_DIR + sep)) {
    const repo = repoRootOf(dirname(f));
    if (repo) {
      throw new Error(`refusing to write ${f} inside a git repository (${repo}) — mailbox data must never be committed. Use a scratchpad or home path, or pass --allow-repo if you really mean it.`);
    }
  }
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  return f;
};

const defaultRules = () => join(STATE_DIR, 'rules.json');
const trim = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

// ── setup ───────────────────────────────────────────────────────────────────

/**
 * Where this mailbox stands, and the single next thing to do.
 *
 * A first run should never open with an empty table. This says, in one look,
 * whether any rules exist, and it is the only command safe to run before
 * anything has been configured.
 */
async function cmdSetup(args) {
  const file = resolve(args.file ?? defaultRules());
  const exists = existsSync(file);
  let rows = [];
  let broken = null;
  if (exists) {
    try { rows = validateRuleSet(JSON.parse(readFileSync(file, 'utf8'))); }
    catch (e) { broken = e.message; }
  }

  const first = !exists || rows.length === 0;
  console.log(table(['State', 'Rules', 'Rule file'], [[
    broken ? 'rule file will not load' : first ? 'first run — no rules yet' : 'ready',
    broken ? '—' : rows.length,
    file.replace(homedir(), '~'),
  ]]));

  if (broken) {
    console.log(`\nthe rule file exists but does not validate: ${broken}`);
    console.log('fix it, or move it aside and start again — nothing will run against a rule set that does not load.');
    process.exitCode = 1;
    return;
  }

  if (first) {
    console.log(`
Nothing is configured yet, and nothing moves until you say so.

  1. I read a slice of your inbox, plus the labels you already have, and
     cluster your mail by sender.
  2. You get candidate rules drawn from YOUR mail — with counts and an example
     subject. Two kinds:
       • trash — bulk mail you do not read
       • sort  — mail worth keeping, filed into one of your folders and taken
                 out of the inbox
     Plus the senders I refused to suggest trashing, and why. Most of those are
     the best things to sort.
  3. You accept the ones you want. Those become your rules.
  4. Every later run plans first, and only ever moves what a rule you accepted
     named. Nothing is deleted: trash is recoverable for 30 days, a filed thread
     is one label away from where it was, and \`undo\` reverses a whole run.

Next: fetch a sample and your label list, then \`propose\`.`);
    return;
  }

  // A summary, not the rule table. `setup` opens every run, and a mailbox with
  // fifty rules was paying six kilobytes of transcript for a table nobody was
  // reading at that moment — the full table is one `rules` away.
  console.log('');
  console.log(table(['Trash', 'Sort', 'Keep', 'Folders'], [[
    rows.filter((r) => r.action === 'trash').length,
    rows.filter((r) => r.action === 'label').length,
    rows.filter((r) => r.action === 'keep').length,
    new Set(rows.filter((r) => r.action === 'label').map((r) => r.label)).size,
  ]]));
  console.log('\nfull rule table: `rules`. Next: fetch a sample, then `plan`.');
}

// ── propose ─────────────────────────────────────────────────────────────────

/**
 * `list_labels` returns objects; a hand-written file may be a bare array of
 * names.
 *
 * System labels are filtered **by name**, not by a `type` field. The live API
 * returns `{labelId, name, messagesTotal, …}` with no type at all, so trusting
 * a type would let INBOX, TRASH, SENT and SPAM through as if they were the
 * user's own folders — which is how "your labels: 24" becomes a number that is
 * wrong by every system label the mailbox has, and how TRASH becomes a
 * destination `propose` is willing to match a sender to.
 */
const readLabels = (p) => {
  if (!p) return [];
  const raw = readJson(p, '--labels <file.json> from list_labels');
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  return list
    .map((l) => (typeof l === 'string'
      ? { name: l, id: null }
      : { name: l?.name ?? l?.label, id: l?.labelId ?? l?.id ?? null }))
    .filter((l) => l.name)
    .filter((l) => {
      if (String(l.type ?? '').toLowerCase() === 'system') return false;
      const upper = l.name.toUpperCase();
      return !SYSTEM_LABELS.includes(upper) && !upper.startsWith('CATEGORY_');
    });
};

/**
 * The label list as `list_labels` gave it, keeping `threadsTotal`.
 *
 * `readLabels` normalises to `{name, id}`, which is right for matching a
 * destination and wrong for auditing: an unmanaged folder holding six threads
 * and an unmanaged folder holding none want opposite remedies — write a rule,
 * or delete it — and the count is the only thing that distinguishes them.
 */
const readLabelsRaw = (p) => {
  if (!p) return [];
  const raw = readJson(p, '--labels <file.json> from list_labels');
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  return list.map((l) => (typeof l === 'string' ? { name: l } : l)).filter((l) => l?.name ?? l?.label);
};

/**
 * id → name over EVERY label, system ones included.
 *
 * `readLabels` deliberately drops the system labels, because they are not the
 * user's folders. This one keeps them, because `search_threads` returns opaque
 * ids (`Label_10`) and resolving them is what lets the planner see that a
 * thread is already filed — and that it is or is not still in the inbox.
 */
const readLabelIndex = (p) => {
  const raw = readJson(p, '--labels <file.json> from list_labels');
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  const index = new Map();
  for (const l of list) {
    if (typeof l === 'string') { index.set(l, l); continue; }
    const name = l?.name ?? l?.label;
    const id = l?.labelId ?? l?.id;
    if (name) index.set(id ?? name, name);
  }
  return index;
};

/**
 * Resolve each thread's opaque `labelIds` into the names a rule is written in.
 *
 * Without this, the already-filed short-circuit in `matches` can never fire on
 * real fetched data — `labelIds` holds `Label_10` and a rule says `Recruiting`
 * — so every run re-proposes every thread it filed last time, and a
 * retroactive pass can never converge.
 */
const resolveThreadLabels = (threads, index) => threads.map((t) => {
  if (Array.isArray(t.labels) && t.labels.length) return t;
  const names = (t.labelIds ?? []).map((id) => index.get(id) ?? id);
  return { ...t, labels: names };
});

async function cmdPropose(args) {
  const threads = readJson(args.threads ?? '', 'propose: --threads <file.json> of fetched threads');
  const labels = readLabels(args.labels);
  // The rule file is read here for the same reason `audit` reads it: a sender
  // an existing rule already claims must never come back as a candidate. A
  // missing rule file is a first run, which is exactly when there is nothing
  // to exclude — so it degrades to the old behaviour rather than failing.
  const ruleFile = resolve(args.rules ?? defaultRules());
  const ruleDoc = existsSync(ruleFile) ? readJson(ruleFile, 'propose: rule file') : { rules: [] };
  const rules = ruleDoc.rules ?? [];
  const r = propose(threads, { minCount: Number(args.minCount ?? 3), labels, rules });
  const { candidates, sortable, withheld, below, reason, sortReason, unhoused, sampled,
    claimed, claimedThreads, sentOnly } = r;

  if (sentOnly > 0) {
    console.log(`${sentOnly} self-sent thread(s) excluded — mail you sent yourself and never filed is your outbox, not triage material.\n`);
  }
  if (claimed.length) {
    console.log(table(['Already claimed', 'Threads', 'By rule'],
      claimed.slice(0, Number(args.showClaimed ?? 8)).map((c) => [c.from, c.count, c.ruleIds.join(', ')])));
    console.log(`${claimedThreads} of ${sampled} thread(s) are already claimed by ${claimed.length} sender(s) your rules cover — excluded from everything below, so a rule you already wrote is never re-proposed or contradicted.\n`);
  }

  console.log('TRASH — bulk mail a rule would move to the trash\n');
  if (candidates.length) {
    console.log(table(['Rule id', 'Sender', 'In sample', 'Bulk', 'Example subject'],
      candidates.map((c) => [c.id, c.from, c.count, c.bulkCount, trim(c.sample, 46)])));
  } else {
    console.log(`No trash candidates — ${reason.text}`);
    if (below.length) {
      console.log('');
      console.log(table(['Closest sender', 'In sample', 'Why not proposed'],
        below.slice(0, 5).map((b) => [b.from, b.count, b.why])));
    }
  }

  console.log('\nSORT — mail worth keeping, filed out of the inbox\n');
  if (sortable.length) {
    console.log(table(['Rule id', 'Sender', 'In sample', 'Destination', 'Folder', 'Leaves inbox'],
      sortable.map((s) => [
        s.id, trim(s.from, 34), s.count,
        s.destination ?? '— needs a name —',
        s.destination ? 'exists' : 'NEW',
        s.keepInInbox ? 'no — tagged in place' : 'yes',
      ])));
    if (unhoused) {
      console.log(`\n${unhoused} sender(s) have no folder that fits. Naming one is your call, not mine —`);
      console.log('a folder name is a decision about how you think, and nothing in the mail says it.');
    }
  } else {
    console.log(`No sort candidates — ${sortReason.text}`);
  }

  if (withheld.length) {
    console.log('');
    console.log(table(['Withheld from trash', 'In sample', 'Why not proposed'],
      withheld.slice(0, Number(args.showWithheld ?? 8)).map((w) => [w.from, w.count, w.why])));
    // State the real count. "most of these can still be sorted" is a claim,
    // and when it is 2 of 16 it is a wrong one.
    console.log(`withheld from TRASHING, not from sorting — ${sortable.length} of these ${withheld.length} appear in the sort table above.`);
  }

  console.log('');
  console.log(table(['Sampled', 'Already claimed', 'Your labels', 'Trash', 'Sort', 'Need a new folder', 'Withheld', 'Below threshold'],
    [[sampled, claimedThreads, labels.length, candidates.length, sortable.length, unhoused, withheld.length, below.length]]));
  console.log('\nnothing has moved — these are candidates. Accept the ones you want with `rules --add`.');

  if (args.out) {
    console.error(`wrote ${writeJson(args.out, {
      candidates: candidates.map(candidateToRule),
      // Only the housed ones become rules here. An unhoused candidate has no
      // destination, and inventing one is the judgment this script does not
      // have — it is carried through unchanged for the agent to name.
      sortCandidates: sortable.filter((s) => !s.unhoused).map((s) => candidateToSortRule(s)),
      unhoused: sortable.filter((s) => s.unhoused),
      withheld,
    }, args)}`);
  }
}

// ── audit ───────────────────────────────────────────────────────────────────

/**
 * Is this label system still coherent?
 *
 * Every other command in this skill asks "what do my rules take". None of them
 * asks whether what the mailbox HAS still makes sense — so a folder no rule
 * files into, or two spellings of one folder, are invisible for as long as
 * nobody happens to look. This is the command that looks, and it is meant to
 * run every time.
 */
async function cmdAudit(args) {
  const labels = readLabelsRaw(args.labels);
  const doc = readJson(args.rules ?? defaultRules(), 'audit: rule file');
  validateRuleSet(doc);
  const threads = args.threads
    ? (args.labels ? resolveThreadLabels(readJson(args.threads, 'audit: --threads'), readLabelIndex(args.labels))
      : readJson(args.threads, 'audit: --threads'))
    : null;
  const a = audit(labels, doc, threads);

  console.log(table(['Label', 'Threads', 'Status', 'Filed into by'],
    a.labels.map((l) => [
      l.name,
      l.threads ?? '—',
      l.nearDuplicateOf.length ? `SAME AS ${l.nearDuplicateOf.join(', ')}`
        : l.managed ? 'managed'
          : l.empty === true ? 'UNMANAGED — and empty'
            : l.empty === false ? 'UNMANAGED — holds mail'
              : 'UNMANAGED — count unknown',
      l.ruleIds.join(', ') || '—',
    ])));

  if (a.duplicates.length) {
    console.log('\none folder, spelled two ways. Mail is split across them and nothing in Gmail says so —');
    console.log(`fold them together with \`merge --from <wrong> --to <right>\`, then delete the empty one.`);
  }
  const orphans = a.unmanaged.filter((l) => l.empty === false && !l.nearDuplicateOf.length);
  const scaffolding = a.unmanaged.filter((l) => l.empty === true && !l.nearDuplicateOf.length);
  const unknown = a.unmanaged.filter((l) => l.empty === null && !l.nearDuplicateOf.length);
  if (orphans.length) {
    console.log(`\n${orphans.length} folder(s) hold mail no rule files into. They stay sorted exactly as long as`);
    console.log('you keep sorting them by hand — write a rule, or the next run will not maintain them.');
  }
  if (scaffolding.length) {
    console.log(`\n${scaffolding.length} folder(s) are empty and unmanaged — folders someone made once and never used.`);
    console.log('Deleting an empty label loses nothing; there is no mail in it to lose.');
  }
  if (unknown.length) {
    console.log(`\n${unknown.length} unmanaged folder(s) came without a thread count, so I cannot tell whether they`);
    console.log('hold mail or are leftover scaffolding — and those want opposite remedies. Re-fetch');
    console.log('`list_labels` (it returns `threadsTotal`) before deciding to delete any of them.');
  }

  if (a.unclaimed) {
    console.log('\nMAIL NO RULE CLAIMS\n');
    if (a.unclaimed.clusters.length) {
      console.log(table(['Sender', 'Threads', 'In inbox', 'Goes to', 'Example subject'],
        a.unclaimed.clusters.map((c) => [
          trim(c.from, 34), c.count, c.inInbox ? 'yes' : 'no',
          c.destination ?? '— needs a name —', trim(c.sample, 40),
        ])));
      if (a.unclaimed.clusters.some((c) => c.unhoused) && a.unclaimed.parents.length) {
        // Printed so a new sender is proposed as a CHILD of something that
        // already exists. Without this the honest answer to "where does this
        // go" is always a new top-level folder, and the system sprawls.
        console.log('\nfolders it could nest under, rather than becoming another top-level one:');
        console.log('  ' + a.unclaimed.parents.join(' · '));
      }
    } else {
      console.log('nothing — every thread in the sample is claimed by a rule.');
    }
    if (a.unclaimed.sentOnly > 0) {
      console.log(`\n${a.unclaimed.sentOnly} self-sent thread(s) excluded — mail you sent yourself and never filed is your outbox, not unclaimed mail.`);
    }
  }

  console.log('');
  console.log(table(['Labels', 'Managed', 'Unmanaged', 'Duplicate spellings', 'Unclaimed mail', 'Coverage'],
    [[a.labels.length, a.managed, a.unmanaged.length, a.duplicates.length,
      a.unclaimed ? a.unclaimed.threads : '— not checked —', `${a.coverage}%`]]));

  if (!a.labels.length) {
    console.log('\nno user labels at all — nothing to audit yet. Run `propose` first.');
    return;
  }
  if (a.clean) {
    console.log('\nevery folder has a rule, no folder is spelled two ways, and no mail is unclaimed.');
    return;
  }
  console.log('\nthis label system needs attention — see above. Nothing has moved.');
  process.exitCode = 1;
}

// ── merge ───────────────────────────────────────────────────────────────────

/**
 * Fold one folder into another.
 *
 * The ordering is the point and it is not cosmetic: the target goes on before
 * the source comes off. Reversed, every thread spends the gap between two API
 * calls in neither folder, and a run that dies in that gap leaves it there.
 */
async function cmdMerge(args) {
  const labelsFile = args.labels;
  const raw = readJson(args.threads ?? '', 'merge: --threads <file.json> of threads carrying the label');
  const threads = labelsFile ? resolveThreadLabels(raw, readLabelIndex(labelsFile)) : raw;
  const m = mergeLabels(threads, { from: args.from, to: args.to });

  console.log(table(['Fold', 'Into', 'Threads carrying it', 'Need the target added', 'Already have it'],
    [[m.from, m.to, m.total, m.label.length, m.alreadyThere]]));

  if (m.total === 0) {
    console.log(`\nno thread in the sample carries "${m.from}".`);
    console.log(`If that is the whole mailbox, the folder is empty and can simply be deleted.`);
    return;
  }

  const receipt = { at: args.at ?? new Date().toISOString(), count: m.total, entries: mergeReceiptEntries(m) };
  const out = args.receipt ?? join(RECEIPTS_DIR, `merge-${receipt.at.replace(/[:.]/g, '-')}.json`);
  console.error(`wrote ${writeJson(out, receipt, args)}`);

  if (m.label.length) {
    console.log(`\nfirst, LABEL "${m.to}" onto exactly these thread ids:`);
    console.log(m.label.map((e) => e.threadId).join('\n'));
  } else {
    console.log(`\nevery thread already carries "${m.to}", so nothing needs labelling first.`);
  }
  console.log(`\nTHEN — not before — remove "${m.from}" from exactly these thread ids:`);
  console.log(m.unlabel.map((e) => e.threadId).join('\n'));
  console.log(`\nfinally, delete the "${m.from}" label itself. It is empty by then, so nothing is lost with it.`);
  console.log('\ndo these in that order. Removing the old label first leaves the mail in neither folder.');
}

// ── subdivide ───────────────────────────────────────────────────────────────

/**
 * Split a folder that has grown into several things.
 *
 * `propose` reads an inbox and asks what wants filing. This reads a folder that
 * already has mail in it and asks whether it is still one category — which is
 * the question a `Recruiting` folder starts raising the moment it holds four
 * employers, and which nothing in this skill could ask before.
 */
async function cmdSubdivide(args) {
  const threads = readJson(args.threads ?? '', 'subdivide: --threads <file.json> of the folder\'s threads');
  const labels = readLabels(args.labels);
  const parent = args.parent;
  const r = subdivide(threads, { parent, labels, minCount: Number(args.minCount ?? 1) });

  console.log(`SPLIT "${r.parent}" — ${r.sampled} thread(s), clustered by sender domain\n`);
  if (r.clusters.length) {
    console.log(table(['Rule id', 'Sender domain', 'Threads', 'Sub-label', 'Folder', 'Named by'],
      r.clusters.map((c) => [
        c.id, trim(c.from, 34), c.count,
        c.destination ?? '— needs a name —',
        c.destination ? 'exists' : 'NEW',
        c.vendorHost ? `the SUBJECT — ${c.vendorHost} hosts many orgs` : 'the sender',
      ])));
  } else {
    console.log(`No clusters — ${r.reason.text}`);
    if (r.below.length) {
      console.log('');
      console.log(table(['Closest cluster', 'Threads', 'Why not proposed'],
        r.below.slice(0, 5).map((b) => [b.from, b.count, b.why])));
    }
  }

  // A vendor-hosted cluster cannot be named from its sender at all, so the
  // subjects are printed: they are where the organisation's name actually is,
  // and reading one is the judgment this command does not have.
  const vendors = r.clusters.filter((c) => c.vendorHost);
  if (vendors.length) {
    console.log('');
    console.log(table(['Hosted sender', 'Vendor', 'Distinct subjects in the folder'],
      vendors.flatMap((c) => c.subjects.slice(0, 4).map((s, i) => [
        i === 0 ? trim(c.from, 30) : '', i === 0 ? c.vendorHost : '', trim(s, 56),
      ]))));
    console.log(`\n${vendors.length} sender(s) send on behalf of other organisations. Naming a sub-label after`);
    console.log('the vendor files every one of them into the same folder — the organisation is in the');
    console.log('subject, and each of these needs a `subjectContains` as well as a name.');
  }

  if (r.single) {
    console.log(`\nonly one sender domain in "${r.parent}" — this folder is still one thing, and splitting it`);
    console.log('would produce a sub-label holding everything the parent already holds. Leave it.');
  } else if (r.unhoused) {
    console.log(`\n${r.unhoused} cluster(s) have no sub-label yet. Naming one is your call, not mine —`);
    console.log('a folder name is a decision about how you think, and nothing in the mail says it.');
  }

  console.log('');
  console.log(table(['Folder', 'Threads', 'Clusters', 'Already have a sub-label', 'Need a name', 'Vendor-hosted', 'Below threshold'],
    [[r.parent, r.sampled, r.clusters.length, r.clusters.length - r.unhoused, r.unhoused, r.vendorHosted, r.below.length]]));
  console.log('\nnothing has moved — these are candidates. Accept the ones you want with `rules --add`.');

  if (args.out) {
    // Same shape `propose` writes, so `rules --add` consumes it unchanged. Only
    // the housed, non-vendor clusters become rules here; the rest are carried
    // through for the agent to name, which is the judgment this command
    // deliberately does not make.
    const ready = r.clusters.filter((c) => !c.unhoused && !c.vendorHost);
    console.error(`wrote ${writeJson(args.out, {
      parent: r.parent,
      sortCandidates: ready.map((c) => clusterToSubRule(c)),
      unhoused: r.clusters.filter((c) => c.unhoused || c.vendorHost),
    }, args)}`);
  }
}

// ── rules ───────────────────────────────────────────────────────────────────

async function cmdRules(args) {
  const file = resolve(args.file ?? defaultRules());
  let doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, rules: [] };

  let addedList = [];
  if (args.add) {
    const incoming = readJson(args.add, 'rules --add <file.json>');
    const list = Array.isArray(incoming)
      ? incoming
      : incoming.candidates || incoming.sortCandidates
        // A propose output carries both halves. Taking only one silently drops
        // every sort rule the user just accepted, and the summary table below
        // would still look right.
        ? [...(incoming.candidates ?? []), ...(incoming.sortCandidates ?? [])]
        : incoming.rules ?? [incoming];
    if (list.length === 0) throw new Error('rules --add: that file contains no rules to add');
    for (const r of list) validateRule(r);
    const byId = new Map(doc.rules.map((r) => [r.id, r]));
    for (const r of list) byId.set(r.id, r);
    doc = { ...doc, rules: [...byId.values()] };
    addedList = list;
  }

  const scope = args.scope ?? DEFAULT_SCOPE;
  const rows = validateRuleSet(doc, { scope });   // throws before anything is written
  // The ids just added or updated — what `--add` reports on, instead of
  // reprinting the whole file to show one new rule at the bottom of it.
  const addedIds = args.add ? new Set(rows.filter((r) => addedList.some((a) => a.id === r.id)).map((r) => r.id)) : null;
  if (args.add) {
    // The previous rule file survives every write. The receipts make a RUN
    // reversible; nothing made the rule file itself reversible, and an --add
    // that goes wrong otherwise destroys the only copy of every rule note.
    if (existsSync(file)) {
      const stamp = (args.at ?? new Date().toISOString()).replace(/[:.]/g, '-');
      const bak = `${file}.${stamp}.bak`;
      copyFileSync(file, bak);
      console.error(`backed up previous rules to ${bak.replace(homedir(), '~')}`);
    }
    writeJson(file, doc, args);
  }

  const shown = addedIds ? rows.filter((r) => addedIds.has(r.id)) : rows;
  console.log(table(['Rule id', 'Action', 'Applies', 'Leaves inbox', 'Matches on', 'Gmail query'],
    shown.map((r) => [
      r.id, r.action,
      // The whole label path, not just the leaf: a rule filing into
      // `Recruiting/Globex` puts `Recruiting` on the thread too, and a user
      // who cannot see that cannot tell why their parent folder keeps filling.
      r.action === 'label' ? r.applies.join(' + ') : '—',
      r.action === 'label' ? (r.archives ? 'yes' : 'no') : '—',
      r.fields.join(', '), trim(r.query, 46),
    ])));
  if (addedIds) {
    console.log(`\n${shown.length} rule(s) added or updated — the other ${rows.length - shown.length} are unchanged. Full table: \`rules\`.`);
  }

  // A rule that can never fire is dead weight, and dead weight in a rule file
  // is what makes a user distrust the whole set. Reported, not refused — the
  // pair that genuinely misbehaves is refused by validateRuleSet itself.
  // On an --add, only the shadows the new rules are part of; the rest were
  // already reported when their rules landed.
  const shadowed = rows.filter((r) => r.shadowedBy)
    .filter((r) => !addedIds || addedIds.has(r.id) || addedIds.has(r.shadowedBy));
  if (shadowed.length) {
    console.log('');
    console.log(table(['Rule that can never fire', 'Because this earlier rule takes everything it would'],
      shadowed.map((r) => [r.id, r.shadowedBy])));
    console.log('an earlier rule owns every thread these would take, so they are dead. Narrow the earlier');
    console.log('rule, or delete these.');
  }

  // Hazards, not refusals — the rules stand as written, but the reader
  // deserves to know which ones are safe only by narrowness or file order.
  const lints = lintRuleSet(doc.rules)
    .filter((l) => !addedIds || addedIds.has(l.ruleId) || (l.otherId && addedIds.has(l.otherId)));
  if (lints.length) {
    console.log('');
    console.log(table(['Rule', 'Warning'], lints.map((l) => [l.ruleId, l.text])));
    console.log('warnings, not refusals — these rules stand as written.');
  }
  console.log('');
  console.log(table(['Rules', 'Trash', 'Sort', 'Keep', 'Folders', 'File'], [[
    rows.length,
    rows.filter((r) => r.action === 'trash').length,
    rows.filter((r) => r.action === 'label').length,
    rows.filter((r) => r.action === 'keep').length,
    new Set(rows.filter((r) => r.action === 'label').map((r) => r.label)).size,
    file.replace(homedir(), '~'),
  ]]));

  if (rows.some((r) => r.action === 'label')) {
    console.log('\nrun `labels --labels <list_labels.json>` before applying — a folder Gmail does not');
    console.log('have is a failed call halfway through a run, with some mail moved and some not.');
  }
}

// ── labels ──────────────────────────────────────────────────────────────────

/**
 * Reconcile every destination the rules need against the labels the mailbox
 * actually has, and refuse to pass until each one exists.
 *
 * This is the gate that keeps `apply` all-or-nothing in practice as well as in
 * principle. Without it, a run against a folder that was never created fails on
 * thread 27 of 50 — half the mail moved, and a receipt describing a mailbox
 * state that no longer exists.
 */
async function cmdLabels(args) {
  const doc = readJson(args.rules ?? defaultRules(), 'labels: rule file');
  validateRuleSet(doc);
  const existing = readLabels(args.labels);
  const dests = reconcileDestinations(doc, existing);

  if (dests.length === 0) {
    console.log(table(['Destinations', 'Your labels', 'To create'], [[0, existing.length, 0]]));
    console.log('\nno rule files anything yet — nothing to reconcile.');
    return;
  }

  const missing = dests.filter((d) => !d.exists);

  // Default output is what needs DOING, not the whole reconciliation. The full
  // table reprinted itself twice in a five-minute run; when everything exists,
  // the summary row says so and `--verbose` has the rest. The label id column
  // stays in the verbose table because `label_thread` takes ids, never names.
  //
  // `Named by` distinguishes a folder a rule files into from one it merely
  // implies by nesting under it — both must exist before anything moves, but
  // only one of them is a decision the user made.
  if (args.verbose) {
    console.log(table(['Destination', 'Status', 'Named by', 'Label id', 'Used by'],
      dests.map((d) => [
        d.name, d.exists ? 'exists' : 'NEEDS CREATE',
        d.implied ? 'implied — parent of a sub-label' : 'a rule',
        d.labelId ?? '—', d.ruleIds.join(', '),
      ])));
  } else if (missing.length) {
    console.log(table(['Destination', 'Named by', 'Used by'],
      missing.map((d) => [
        d.name,
        d.implied ? 'implied — parent of a sub-label' : 'a rule',
        d.ruleIds.join(', '),
      ])));
  }

  const variants = dests.filter((d) => d.variants.length);
  if (variants.length) {
    console.log('');
    console.log(table(['One folder, spelled two ways', 'Would be created as'],
      variants.map((d) => [[d.name, ...d.variants].join(' / '), d.name])));
    console.log('these are one folder, not two. Fix the spelling if that is not what you meant.');
  }

  if (args.verbose || missing.length || variants.length) console.log('');
  console.log(table(['Destinations', 'Your labels', 'To create'], [[dests.length, existing.length, missing.length]]));

  if (missing.length) {
    console.log('\ncreate exactly these labels, then re-run this command:');
    console.log(missing.map((d) => d.name).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('\nevery folder these rules need already exists. Safe to plan and apply.');
}

// ── plan ────────────────────────────────────────────────────────────────────

async function cmdPlan(args) {
  const raw = readJson(args.threads ?? '', 'plan: --threads <file.json>');
  const scope = args.scope ?? DEFAULT_SCOPE;
  // Resolving `labelIds` to names is what makes a re-run converge: a rule
  // cannot tell it has already filed a thread while the thread's labels are
  // opaque ids (`Label_10`) and the rule is written in words (`Recruiting`).
  const threads = args.labels ? resolveThreadLabels(raw, readLabelIndex(args.labels)) : raw;
  const doc = readJson(args.rules ?? defaultRules(), 'plan: rule file');
  validateRuleSet(doc, { scope });
  const p = plan(threads, doc, { scope });

  const byRule = new Map();
  for (const t of p.taken) byRule.set(t.ruleId, (byRule.get(t.ruleId) ?? 0) + 1);

  console.log(table(['Rule id', 'Action', 'Applies', 'Leaves inbox', 'Threads'],
    [...byRule].map(([id, n]) => {
      const r = doc.rules.find((x) => x.id === id);
      const isSort = r?.action === 'label';
      const row = p.taken.find((t) => t.ruleId === id);
      return [
        id, r?.action ?? '?',
        // The whole label path, because a sub-label rule applies its parent too.
        isSort ? (row?.labels ?? [r.label]).join(' + ') : '—',
        // Counted per thread rather than declared per rule: an archiving rule
        // cannot archive a thread that is already out of the inbox, and on a
        // retroactive pass over filed mail every thread is.
        isSort ? `${p.taken.filter((t) => t.ruleId === id && t.archive).length} of ${n}` : '—',
        n,
      ];
    })));

  const preview = p.taken.slice(0, Number(args.preview ?? 12));
  if (preview.length) {
    console.log('');
    console.log(table(['Rule id', 'Goes to', 'From', 'Subject'],
      preview.map((t) => [t.ruleId, t.action === 'label' ? trim(t.label, 20) : 'trash', trim(t.from, 30), trim(t.subject, 40)])));
    if (p.taken.length > preview.length) console.log(`\n${p.taken.length - preview.length} more not shown — \`--preview N\` to widen.`);
  }

  if (p.overlaps.length) {
    console.log('');
    console.log(table(['Claimed by more than one rule', 'Rules'],
      p.overlaps.slice(0, 6).map((o) => [trim(o.subject, 44), o.ruleIds.join(', ')])));
    console.log('the first matching rule owns a thread, so attribution stays unambiguous.');
  }

  if (p.destinations.length) {
    console.log('');
    // Counted over the whole label path, not the leaf. A parent folder is
    // where the sum of its sub-labels lands, and a table showing `Recruiting: 0`
    // beside four sub-labels holding thirteen threads is a table that reads as
    // a bug.
    console.log(table(['Folder', 'Threads', 'New to the thread'],
      p.destinations.map((d) => [
        d,
        p.taken.filter((t) => (t.labels ?? [t.label]).includes(d)).length,
        p.taken.filter((t) => (t.adds ?? t.labels ?? [t.label]).includes(d)).length,
      ])));
    console.log('reconcile these against your real labels with `labels` before applying.');
  }

  console.log('');
  console.log(table(['Scope', 'Scanned', 'Would trash', 'Would file', 'Would leave the inbox', 'Kept by a keep rule', 'Overlaps'],
    [[
      p.scope ?? DEFAULT_SCOPE,
      p.scanned,
      p.taken.filter((t) => t.action === 'trash').length,
      p.taken.filter((t) => t.action === 'label').length,
      p.taken.filter((t) => t.action === 'label' && t.archive).length,
      p.spared.length,
      p.overlaps.length,
    ]]));
  console.log('\nnothing has moved — this is what the rules would do.');

  if (args.out) console.error(`wrote ${writeJson(args.out, p, args)}`);
}

// ── apply ───────────────────────────────────────────────────────────────────

async function cmdApply(args) {
  const p = readJson(args.plan ?? '', 'apply: --plan <plan.json>');
  const wantTrash = args.trash ? readJson(args.trash, 'apply: --trash <ids.json>') : null;
  const wantSort = args.sort ? readJson(args.sort, 'apply: --sort <ids.json>') : null;

  // Throws when a requested thread is not in the plan UNDER THAT ACTION. No
  // receipt is written, and the agent is told exactly which ids had no rule
  // behind them. Authorising both before writing anything keeps a run
  // all-or-nothing: a rogue id in either list stops the whole thing.
  const trashed = authorise(p, wantTrash, 'trash');
  const filed = authorise(p, wantSort, 'label');
  const entries = [...trashed, ...filed];
  if (entries.length === 0) throw new Error('apply: this plan authorises nothing — there is nothing to do');

  const receipt = buildReceipt(entries, { at: args.at ?? new Date().toISOString() });

  // Keyed on the rule id alone: a rule has exactly one action and one
  // destination, so a composite key would buy nothing and would split wrongly
  // the moment a folder name contains a space.
  const byRule = new Map();
  for (const e of entries) {
    if (!byRule.has(e.ruleId)) byRule.set(e.ruleId, { action: e.action, label: e.label, n: 0 });
    byRule.get(e.ruleId).n += 1;
  }

  console.log(table(['Rule id', 'Action', 'Destination', 'Authorised threads'],
    [...byRule].map(([id, r]) => [id, r.action === 'label' ? 'file' : r.action, r.label ?? '—', r.n])));
  console.log('');
  console.log(table(['Authorised', 'To trash', 'To file', 'Labels to add', 'To archive', 'Refused'], [[
    entries.length,
    trashed.length,
    filed.length,
    // Not the same as "to file": a sub-label rule puts the parent on the thread
    // too, and a thread that already carries the parent needs only the child.
    filed.reduce((n, e) => n + (e.adds ?? e.labels ?? [e.label]).length, 0),
    filed.filter((e) => e.archive).length,
    0,
  ]]));

  // The default is the durable path, and it is deliberately not a flag the
  // flow asks anyone to pass: every receipt that landed in a session scratchpad
  // died with the session, and three real runs are un-undoable because of it.
  const out = args.receipt ?? join(RECEIPTS_DIR, `${receipt.at.replace(/[:.]/g, '-')}.json`);
  console.error(`wrote ${writeJson(out, receipt, args)}`);

  // Replay the authorised moves onto the working snapshot, so a re-plan
  // converges without re-fetching — and without the agent hand-editing JSON,
  // which is how a mid-run rule addition used to cost three manual edits.
  // The receipt above stays the source of truth; this mutates only the
  // snapshot the next `plan` reads.
  if (args.updateThreads) {
    const snapPath = resolve(args.updateThreads);
    const snapshot = readJson(snapPath, 'apply: --update-threads <threads.json>');
    const byId = new Map(entries.map((e) => [e.threadId, e]));
    const updated = snapshot
      .filter((t) => byId.get(t.id)?.action !== 'trash')
      .map((t) => {
        const e = byId.get(t.id);
        if (!e || e.action !== 'label') return t;
        // The added LABEL NAMES go into labelIds, not into a `labels` array.
        // `resolveThreadLabels` passes an entry it cannot resolve through
        // verbatim, so a name mixed in among the opaque ids resolves to itself
        // — while a pre-populated `labels` array would short-circuit the
        // resolver entirely and every OTHER label id on the thread would stop
        // resolving, which un-converges exactly the rules this exists to
        // converge.
        const adds = (e.adds ?? e.labels ?? [e.label]).filter(Boolean);
        let labelIds = [...new Set([...(t.labelIds ?? []), ...adds])];
        let labels = Array.isArray(t.labels) && t.labels.length ? [...new Set([...t.labels, ...adds])] : null;
        if (e.archive) {
          const notInbox = (l) => String(l).toUpperCase() !== 'INBOX';
          labelIds = labelIds.filter(notInbox);
          if (labels) labels = labels.filter(notInbox);
        }
        return labels ? { ...t, labelIds, labels } : { ...t, labelIds };
      });
    writeJson(snapPath, updated, args);
    console.error(`updated ${snapPath} — a re-plan over it now converges without re-fetching`);
  }

  // Three separate instruction blocks, because they are three different calls.
  // Merging them would hand the agent a list of ids and leave it to infer what
  // to do with each — which is exactly the inference this skill exists to
  // remove from the model.
  if (trashed.length) {
    console.log('\nTRASH exactly these thread ids and nothing else:');
    console.log(trashed.map((e) => e.threadId).join('\n'));
  }
  // Grouped by every label a destination path implies, and only the ones the
  // thread does not already carry. A rule filing into `Recruiting/Globex`
  // emits two blocks for a thread new to both, and one block for a thread that
  // was already in `Recruiting` — which is the whole retroactive case.
  //
  // Outermost first, so a parent never arrives after its child.
  const byLabel = new Map();
  for (const e of filed) {
    for (const label of (e.adds ?? e.labels ?? [e.label]).filter(Boolean)) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(e);
    }
  }
  for (const [label, es] of [...byLabel].sort((a, b) => a[0].split('/').length - b[0].split('/').length)) {
    console.log(`\nLABEL "${label}" onto exactly these thread ids and nothing else:`);
    console.log(es.map((e) => e.threadId).join('\n'));
  }
  const toArchive = filed.filter((e) => e.archive);
  if (toArchive.length) {
    console.log('\nthen REMOVE the INBOX label from exactly these thread ids — this is the "move":');
    console.log(toArchive.map((e) => e.threadId).join('\n'));
  }
  // Two different reasons a thread is not archived, and calling both "stays in
  // the inbox by rule" is wrong on a retroactive pass — a run over mail already
  // filed reported 13 threads staying in an inbox none of them were in.
  const stays = filed.filter((e) => !e.archive && e.wouldArchive !== true);
  const alreadyOut = filed.filter((e) => !e.archive && e.wouldArchive === true);
  if (stays.length) {
    console.log(`\n${stays.length} filed thread(s) stay in the inbox by rule. Do NOT remove INBOX from those.`);
  }
  if (alreadyOut.length) {
    console.log(`\n${alreadyOut.length} filed thread(s) had already left the inbox — this run only adds labels to them.`);
  }
}

// ── undo ────────────────────────────────────────────────────────────────────

async function cmdUndo(args) {
  // `--last` finds the newest receipt in the durable store, by the `at` each
  // receipt records rather than by filename — the legacy files and the merge
  // receipts spell their names three ways, and mtime lies after a file copy.
  if (args.last && !args.receipt) {
    const candidates = [];
    if (existsSync(RECEIPTS_DIR)) {
      for (const f of readdirSync(RECEIPTS_DIR)) if (f.endsWith('.json')) candidates.push(join(RECEIPTS_DIR, f));
    }
    if (existsSync(STATE_DIR)) {
      for (const f of readdirSync(STATE_DIR)) if (/^receipt-.*\.json$/.test(f)) candidates.push(join(STATE_DIR, f));
    }
    if (candidates.length === 0) {
      throw new Error(`undo --last: no receipts under ${RECEIPTS_DIR.replace(homedir(), '~')} — pass --receipt <file> explicitly`);
    }
    const dated = candidates.map((p) => {
      try { return { p, at: String(JSON.parse(readFileSync(p, 'utf8')).at ?? '') }; }
      catch { return { p, at: '' }; }
    }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.p < b.p ? 1 : -1));
    args.receipt = dated[0].p;
    console.log(`undoing the last recorded run — ${args.receipt.replace(homedir(), '~')} (${dated[0].at || 'no timestamp'})\n`);
  }
  const r = readJson(args.receipt ?? '', 'undo: --receipt <receipt.json>');
  const entries = r.entries ?? [];
  if (entries.length === 0) throw new Error('undo: that receipt records no threads');

  // An entry with no `action` was written by 0.1.0, which could only trash.
  const u = undoPlan(r);

  console.log(table(['Thread id', 'Taken by', 'What happened', 'From', 'Subject'],
    entries.slice(0, Number(args.preview ?? 15)).map((e) => [
      e.threadId, e.ruleId,
      // The labels this run ADDED, which on a retroactive pass is a subset of
      // where the thread now lives — undo must not take back a label the user
      // had filed by hand before the run.
      (e.action ?? 'trash') === 'trash'
        ? 'trashed'
        : `filed → ${(Array.isArray(e.added) && e.added.length ? e.added : [e.label]).join(' + ')}${e.archived ? ' (left inbox)' : ''}`,
      trim(e.from, 24), trim(e.subject, 34),
    ])));
  console.log('');
  console.log(table(['To restore', 'Trashed', 'Filed', 'Left the inbox', 'Run at'],
    [[u.total, u.untrash.length, u.total - u.untrash.length, u.reinbox.length, r.at]]));

  // Three operations, listed separately, because reversing a trash and
  // reversing a move are not the same call. Removing TRASH from a thread that
  // was filed restores nothing and hides that it is still out of the inbox.
  if (u.untrash.length) {
    console.log('\nremove the TRASH label from exactly these thread ids:');
    console.log(u.untrash.map((e) => e.threadId).join('\n'));
  }
  for (const { label, entries: es } of u.unlabel) {
    console.log(`\nremove the "${label}" label from exactly these thread ids:`);
    console.log(es.map((e) => e.threadId).join('\n'));
  }
  // Reversing a merge means putting the folded-away folder back — and it was
  // deleted at the end of that merge, so it has to be created again first.
  // Emitting a bare `label_thread` here would fail against an id that no
  // longer exists.
  for (const { label, entries: es } of u.relabel ?? []) {
    console.log(`\nre-create the "${label}" label if it is gone, then ADD it back to exactly these thread ids:`);
    console.log(es.map((e) => e.threadId).join('\n'));
  }
  if (u.reinbox.length) {
    console.log('\nthen ADD the INBOX label back to exactly these thread ids — they were archived:');
    console.log(u.reinbox.map((e) => e.threadId).join('\n'));
  }
}

// ── ingest ──────────────────────────────────────────────────────────────────

/**
 * Raw MCP tool output → the snapshots every other command reads.
 *
 * The agent writes each tool result to a file VERBATIM; the reshaping — dedupe,
 * label-id union, category intersection, the bulk-mail proxy — happens here,
 * where it is deterministic and tested, instead of in sixty seconds of
 * hand-authored JSON per run. Only the seven snapshot fields are ever written:
 * a raw response carries `snippet`, which on a real mailbox has held live
 * verification codes, and nothing here copies it anywhere.
 */
async function cmdIngest(args) {
  if (!args.inbox || args.inbox === true) throw new Error('ingest: --inbox <raw.json> is required — write the search_threads result to a file verbatim');
  if (!args.labels || args.labels === true) throw new Error('ingest: --labels <raw.json> is required — without the real label list, every later step guesses the id↔name mapping');

  const inbox = normalizeSearchThreads(readJson(args.inbox, 'ingest: --inbox'), '--inbox');
  const nolabel = args.nolabel ? normalizeSearchThreads(readJson(args.nolabel, 'ingest: --nolabel'), '--nolabel') : [];
  const promoIds = args.promos ? threadIds(readJson(args.promos, 'ingest: --promos'), '--promos') : [];
  const updateIds = args.updates ? threadIds(readJson(args.updates, 'ingest: --updates'), '--updates') : [];
  const labelsDoc = normalizeLabels(readJson(args.labels, 'ingest: --labels'));

  const merged = mergeThreadSources(inbox, nolabel);
  const threads = applyCategories(merged, promoIds, updateIds);

  console.log(table(['Source', 'Threads', 'New'], [
    ['in:inbox', inbox.length, inbox.length],
    ['has:nouserlabels', nolabel.length, merged.length - inbox.length],
  ]));

  // A thread with no sender or subject is almost always a metadata-only fetch,
  // and passing it through produces subject-less "unclaimed mail" an hour
  // later. Refused before anything is written, and the cause is named.
  const problems = validateIngest(threads);
  if (problems.length && !args.force) {
    console.log(`\n${problems.length} thread(s) have no subject or sender — this looks like a metadata-only fetch`);
    console.log('(THREAD_VIEW_METADATA_ONLY strips both). Re-fetch the inbox and no-label searches with the');
    console.log('default view, or pass --force to ingest them anyway. Nothing was written.');
    process.exitCode = 1;
    return;
  }

  const sentOnly = threads.filter((t) => isSentOnly(t)).length;
  const userLabels = (labelsDoc.labels ?? []).filter((l) => {
    const upper = String(l?.name ?? l ?? '').toUpperCase();
    return upper && !SYSTEM_LABELS.includes(upper) && !upper.startsWith('CATEGORY_');
  }).length;

  const outThreads = writeJson(args.outThreads ?? 'threads.json', threads, args);
  const outLabels = writeJson(args.outLabels ?? 'labels.json', labelsDoc, args);
  console.error(`wrote ${outThreads}`);
  console.error(`wrote ${outLabels}`);

  console.log('');
  console.log(table(['Threads', 'Promotions', 'Updates', 'Bulk', 'Sent-only', 'Missing subject/from', 'Your labels', 'System labels'], [[
    threads.length,
    threads.filter((t) => t.category === 'promotions').length,
    threads.filter((t) => t.category === 'updates').length,
    threads.filter((t) => t.hasUnsubscribe).length,
    sentOnly,
    problems.length,
    userLabels,
    (labelsDoc.labels ?? []).length - userLabels,
  ]]));

  if (!args.promos && !args.updates) {
    console.log('\nno category fetches supplied — hasUnsubscribe is false everywhere, so every trash rule');
    console.log('requiring a bulk marker will match nothing. Fetch category:promotions and category:updates');
    console.log('(ids only) unless this run truly does not need them.');
  }
  console.log('\nsnippets are never written — the snapshot carries sender, subject, date and labels, nothing else.');
}

const USAGE = `gmailtriage v${VERSION} — triage and sort a Gmail inbox against rules you wrote.

  gmailtriage setup     [--file <rules.json>]
  gmailtriage ingest    --inbox <raw.json> --labels <raw.json> [--nolabel <raw.json>] [--promos <raw.json>]
                        [--updates <raw.json>] [--out-threads <f.json>] [--out-labels <f.json>] [--force]
  gmailtriage audit     --labels <f.json> [--rules <f.json>] [--threads <f.json>]
  gmailtriage merge     --from <Label> --to <Label> --threads <f.json> [--labels <f.json>] [--receipt <f.json>]
  gmailtriage propose   --threads <f.json> [--labels <f.json>] [--rules <f.json>] [--min-count N]
                        [--show-claimed N] [--show-withheld N] [--out <f.json>]
  gmailtriage subdivide --threads <f.json> --parent <Label> [--labels <f.json>] [--min-count N] [--out <f.json>]
  gmailtriage rules     [--file <rules.json>] [--add <f.json>] [--scope <query>]
  gmailtriage labels    --labels <f.json> [--rules <f.json>] [--verbose]
  gmailtriage plan      --threads <f.json> [--rules <f.json>] [--labels <f.json>] [--scope <query>] [--preview N] [--out <plan.json>]
  gmailtriage apply     --plan <plan.json> [--trash <ids.json>] [--sort <ids.json>] [--update-threads <threads.json>]
                        [--receipt <f.json>] [--at <iso>]
  gmailtriage undo      --receipt <f.json> | --last

\`ingest\` takes the RAW output of the Gmail search_threads / list_labels tools,
written to files verbatim, and produces the thread and label snapshots every
other command reads — never transcribe a tool response by hand.

Receipts default to ~/.gmailtriage/receipts/, which is what makes \`undo --last\`
work across sessions. \`--scope\` is the slice of the mailbox the rules are
evaluated against, and defaults to \`${DEFAULT_SCOPE}\`. A retroactive pass over
mail already filed is \`--scope 'label:Recruiting'\` — pass \`--labels\` with it,
or the planner cannot see which threads it has already filed and will never
converge.

Data outputs are refused inside a git repository (--allow-repo overrides):
a mailbox snapshot in a working tree is one \`git add\` away from public.

This binary never touches Gmail. The agent fetches, trashes, labels and
archives; this decides what a rule may take, and refuses anything a rule did
not name — for every action, not only for trashing.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'setup': return await cmdSetup(args);
      case 'ingest': return await cmdIngest(args);
      case 'audit': return await cmdAudit(args);
      case 'merge': return await cmdMerge(args);
      case 'propose': return await cmdPropose(args);
      case 'subdivide': return await cmdSubdivide(args);
      case 'rules': return await cmdRules(args);
      case 'labels': return await cmdLabels(args);
      case 'plan': return await cmdPlan(args);
      case 'apply': return await cmdApply(args);
      case 'undo': return await cmdUndo(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    const tag = err instanceof NotAuthorised ? 'REFUSED' : err instanceof RuleProblem ? 'rule' : 'gmailtriage';
    console.error(`${tag}: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
