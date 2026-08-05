/**
 * Planning, proposing, authorising, and undoing.
 *
 * Nothing here talks to Gmail — the MCP is agent-side, so the agent fetches and
 * the agent trashes. What lives here is the part that must not depend on a
 * model behaving well: which threads a rule takes, whether a thread was
 * authorised, and what was actually moved.
 */
import { matches, toGmailQuery, normaliseLabel, archives } from './rules.mjs';

// ── proposing ───────────────────────────────────────────────────────────────

const domainOf = (from) => {
  const m = /<?([^<>@\s]+)@([^<>\s]+)>?\s*$/.exec(String(from ?? '').trim());
  return m ? m[2].toLowerCase() : null;
};

const addressOf = (from) => {
  const m = /<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(String(from ?? '').trim());
  return m ? m[1].toLowerCase() : null;
};

/**
 * Senders this skill never proposes a trash rule for, however bulky they look.
 * A first run that suggests trashing your bank is a first run nobody trusts
 * again — and the cost of missing one retailer is a rule the user adds by hand.
 */
/*
 * NOTE THE MISSING \b. Domains concatenate words — "valleyhealth.example",
 * "myworkday.com", "candidates.workablemail.com" — so a word-boundary match
 * silently fails on exactly the senders that matter most. These are substring
 * matches on purpose.
 *
 * That over-matches: a legitimate "healthyrecipes.com" is withheld too. The
 * asymmetry is deliberate — a withheld sender costs the user one hand-written
 * rule, and a wrongly-proposed one can cost them an interview or a statement.
 */
export const NEVER_PROPOSE = [
  /(^|\.)(gov|edu|mil)$/,
  /(bank|chase|wellsfargo|schwab|fidelity|vanguard|irs|paypal|stripe|creditunion)/,
  /(doctor|clinic|health|hospital|pharmacy|insur|mychart|dental|medic)/,
  /(school|district|k12|university|college|academy)/,
  // Recruiting mail looks exactly like bulk mail and is not: it carries live
  // applications and interview scheduling. A first run proposed trashing an
  // active job pipeline, which is how a helpful tool becomes an expensive one.
  /(careers|recruit|jobs|talent|hiring|workday|greenhouse|ashby|workable|lever\.co|smartrecruiters)/,
];

/**
 * Subjects that mean "losing this costs you something you cannot get back".
 * One of these anywhere in a sender's cluster withholds the whole sender: a
 * sender that ever delivers a login code is a sender you cannot bulk-trash,
 * however much marketing it also sends.
 */
export const NEVER_PROPOSE_SUBJECT = [
  /\b(multifactor|two[- ]factor|2fa|mfa)\b/i,
  /\b(access|security|verification|confirmation|one[- ]time) code\b/i,
  /\bverify your\b|\bconfirm your email\b/i,
  /\bpassword\b|\bsign[- ]?in\b/i,
  /\breceipt\b|\binvoice\b|\bstatement\b/i,
];

/**
 * Checks the WHOLE address, not just the domain.
 *
 * `centralschools@parentvendor.example` is a school district behind a vendor's domain:
 * the domain carries no marker at all and the local part carries all of it. A
 * live run proposed trashing it — bus registration and activity sign-ups —
 * because the guard only ever looked to the right of the @.
 */
export const isProtected = (address) => !!address && NEVER_PROPOSE.some((re) => re.test(String(address).toLowerCase()));

export const hasProtectedSubject = (group) =>
  group.some((t) => NEVER_PROPOSE_SUBJECT.some((re) => re.test(String(t.subject ?? ''))));

/**
 * Domain and address words that identify nothing. Every sender has them, so a
 * destination match on one of these is a match on nothing at all.
 */
const NOISE_TOKENS = new Set([
  'com', 'org', 'net', 'co', 'io', 'us', 'gov', 'edu', 'mil', 'info', 'biz',
  'mail', 'email', 'e', 'em', 'news', 'newsletter', 'no', 'noreply', 'reply',
  'notification', 'notifications', 'notify', 'updates', 'update', 'support',
  'hello', 'hi', 'team', 'contact', 'info', 'help', 'service', 'services',
  'account', 'accounts', 'members', 'member', 'send', 'sendgrid', 'mailer',
  'marketing', 'do', 'not', 'donotreply', 'inbox', 'online', 'www', 'my',
]);

/** The words in an address that could plausibly name a folder. */
export const addressTokens = (address) =>
  String(address ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t));

/**
 * Match a sender against the labels the mailbox already has.
 *
 * Deliberately **exact** on a whole label segment. Fuzzy matching here would
 * put a clinic's mail under "Health Insurance" or "Healthcare" on a coin flip,
 * and a folder chosen by coin flip is worse than no folder: the user stops
 * trusting where anything went. Most clusters therefore come back unhoused,
 * which is correct — naming a new folder is a judgment about how the user
 * thinks, and the script does not have it.
 */
export function matchDestination(address, labels = []) {
  const tokens = new Set(addressTokens(address));
  if (tokens.size === 0) return null;
  for (const raw of labels) {
    const name = typeof raw === 'string' ? raw : raw?.name ?? raw?.label;
    if (!name) continue;
    for (const seg of normaliseLabel(name).split('/')) {
      const flat = seg.replace(/[^a-z0-9]+/g, '');
      if (flat.length >= 3 && tokens.has(flat)) return name;
    }
  }
  return null;
}

/**
 * Cluster a real inbox sample into candidate rules. Counts come from the
 * sample, so they are evidence of bulk, not a promise about the mailbox.
 */
export function propose(threads, { minCount = 3, labels = [] } = {}) {
  const byAddr = new Map();
  for (const t of threads) {
    const addr = addressOf(t.from);
    if (!addr) continue;
    if (!byAddr.has(addr)) byAddr.set(addr, []);
    byAddr.get(addr).push(t);
  }

  const candidates = [];
  const withheld = [];
  const below = [];
  for (const [addr, group] of byAddr) {
    // the whole address, because the marker is often in the local part
    const bulk = group.filter((t) => t.hasUnsubscribe).length;
    const row = {
      id: addr.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
      from: addr,
      count: group.length,
      bulkCount: bulk,
      sample: group[0].subject ?? '',
    };
    // Carried through to the sort pass: WHY a sender is withheld from trash
    // decides whether it may be filed, and whether it may leave the inbox.
    row.sensitive = hasProtectedSubject(group);
    if (isProtected(addr)) { withheld.push({ ...row, kind: 'protected-sender', why: 'sender looks financial, medical, educational, governmental or recruiting' }); continue; }
    if (row.sensitive) { withheld.push({ ...row, kind: 'protected-subject', why: 'cluster contains a login code, receipt or verification you cannot lose' }); continue; }
    // The bulk check comes BEFORE the threshold check on purpose. Reversed, a
    // person with two threads lands in `below`, and the "closest sender" table
    // then invites the user to lower the threshold to catch their own realtor.
    // `below` must only ever hold senders that would really become candidates.
    if (bulk === 0) { withheld.push({ ...row, kind: 'no-bulk-marker', why: 'no bulk-mail marker — may be a person, not a sender' }); continue; }
    if (group.length < minCount) { below.push({ ...row, why: `only ${group.length} in the sample (threshold ${minCount})` }); continue; }
    candidates.push(row);
  }

  // ── the sort pass ─────────────────────────────────────────────────────────
  //
  // The withheld table used to be where a first run stopped: "I won't suggest
  // trashing your bank" and nothing further. But a bank, a school district and
  // a recruiter are the BEST things in the mailbox to file — high volume,
  // unambiguously categorisable, and exactly the mail you want out of the
  // inbox without wanting it gone. Withheld from trash is not withheld from
  // sorting, and this is where that distinction pays.
  const sortable = [];
  for (const w of withheld) {
    // Never file a person. This is the one withholding reason that also
    // withholds sorting: auto-archiving a human's mail out of the inbox is
    // the most damaging thing this skill could do, and a cluster with no bulk
    // marker is exactly the case where it cannot tell.
    if (w.kind === 'no-bulk-marker') continue;
    // A protected SUBJECT proves the cluster matters; it does not prove the
    // sender is an institution rather than a person, so still require bulk.
    if (w.kind === 'protected-subject' && w.bulkCount === 0) continue;
    if (w.count < minCount) continue;
    sortable.push({
      id: `sort-${w.id}`.slice(0, 40).replace(/-+$/, ''),
      from: w.from,
      count: w.count,
      bulkCount: w.bulkCount,
      sample: w.sample,
      // Any cluster that ever delivered a code, receipt or verification is
      // tagged in place and never archived. You can file your receipts and
      // still find the login code you are waiting for in your inbox.
      keepInInbox: w.sensitive === true,
      destination: matchDestination(w.from, labels),
      why: w.why,
    });
  }
  for (const s of sortable) s.unhoused = s.destination === null;

  const bySize = (a, b) => b.count - a.count || a.from.localeCompare(b.from);
  candidates.sort(bySize);
  withheld.sort(bySize);
  below.sort(bySize);
  sortable.sort(bySize);

  // An empty candidate list is a result, not a failure — but only if it says
  // which of the three reasons produced it. A bare empty table reads as "the
  // skill is broken".
  const reason = candidates.length > 0 ? null
    : below.length > 0
      ? { kind: 'below-threshold', best: below[0].count, minCount,
          text: `no sender reached the threshold of ${minCount}. The largest unguarded cluster has ${below[0].count} (${below[0].from}) — re-run with --min-count ${below[0].count} to see it.` }
      : withheld.length > 0
        ? { kind: 'all-withheld',
            text: `every sender in the sample was withheld from trashing by a guard. That is the safe answer, not a broken one${sortable.length ? ` — and ${sortable.length} of them can still be filed, below` : ' — read the withheld table and write a rule by hand for anything you disagree with'}.` }
        : { kind: 'nothing-bulk',
            text: 'no bulk mail in the sample at all. Widen the fetch, or this inbox is already clean.' };

  // An empty sort table is a result too, and it says which of three things
  // produced it — same contract as `reason`, for the same reason: a bare empty
  // table reads as a broken skill.
  const sortReason = sortable.length > 0 ? null
    : withheld.some((w) => w.kind !== 'no-bulk-marker')
      ? { kind: 'below-threshold',
          text: `nothing reached the threshold of ${minCount} to be worth its own folder. Re-run with a lower \`--min-count\` to see the near misses.` }
      : withheld.length > 0
        ? { kind: 'only-people',
            text: 'every withheld sender looks like a person rather than a sender, and this skill never files a person\'s mail out of your inbox. Write that rule by hand if you want it.' }
        : { kind: 'nothing-to-file',
            text: 'nothing in the sample was withheld from trashing, so there is nothing left over to file.' };

  const unhoused = sortable.filter((s) => s.unhoused).length;

  return {
    candidates, withheld, below, reason, sampled: threads.length,
    sortable, sortReason, unhoused,
    knownLabels: (labels ?? []).length,
  };
}

/** A candidate turned into a real rule object, ready for validation. */
export const candidateToRule = (c) => ({
  id: c.id,
  action: 'trash',
  match: { from: c.from, hasUnsubscribe: true },
  note: `bulk mail from ${c.from} — ${c.count} in the sample, e.g. "${String(c.sample).slice(0, 60)}"`,
});

/**
 * A sort candidate turned into a real rule.
 *
 * `destination` is required and is NOT invented when the candidate is
 * unhoused: naming a folder is the judgment the script does not have, and
 * quietly deriving one here is how a skill ends up filing a school district
 * into a folder called "Parentvendor" after its mail vendor.
 *
 * Note the match is the sender alone — no `hasUnsubscribe`. Filing is not
 * conditional on bulk the way trashing is: a bank statement is precisely the
 * thing you want in a folder, and it may carry no bulk marker at all.
 */
export const candidateToSortRule = (c, destination = c.destination) => {
  if (!destination) {
    throw new Error(`sort candidate ${c.from} has no destination — name the folder before turning it into a rule`);
  }
  const rule = {
    id: c.id,
    action: 'label',
    label: destination,
    match: { from: c.from },
    note: `file mail from ${c.from} — ${c.count} in the sample, e.g. "${String(c.sample).slice(0, 60)}"`,
  };
  if (c.keepInInbox) {
    rule.keepInInbox = true;
    rule.note += ' — tagged in place, never archived: this sender also delivers codes or receipts';
  }
  return rule;
};

// ── planning ────────────────────────────────────────────────────────────────

/**
 * Exactly which threads each rule takes. `keep` wins over everything: a thread
 * a keep rule claims is never trashed, whatever else matched it.
 */
export function plan(threads, ruleDoc, { now = new Date() } = {}) {
  const rules = ruleDoc.rules ?? [];
  const keeps = rules.filter((r) => r.action === 'keep');
  const actors = rules.filter((r) => r.action !== 'keep');

  const taken = [];
  const spared = [];
  const claims = new Map();

  for (const t of threads) {
    const keptBy = keeps.find((r) => matches(r, t, now));
    if (keptBy) { spared.push({ threadId: t.id, from: t.from, subject: t.subject, ruleId: keptBy.id }); continue; }
    for (const r of actors) {
      if (!matches(r, t, now)) continue;
      taken.push({
        ruleId: r.id, action: r.action, threadId: t.id, from: t.from, subject: t.subject,
        // Carried on every taken row so `apply` never has to re-read the rule
        // file to know where a thread goes, and so the plan on disk is a
        // complete description of what will happen to the mailbox.
        label: r.action === 'label' ? r.label : null,
        archive: archives(r),
      });
      if (!claims.has(t.id)) claims.set(t.id, []);
      claims.get(t.id).push(r.id);
      break; // first matching rule owns it, so attribution is never ambiguous
    }
  }

  const overlaps = [];
  for (const t of threads) {
    const all = actors.filter((r) => matches(r, t, now)).map((r) => r.id);
    if (all.length > 1) overlaps.push({ threadId: t.id, subject: t.subject, ruleIds: all });
  }

  return {
    scanned: threads.length,
    taken,
    spared,
    overlaps,
    // Every distinct folder this plan would file into, so the destinations can
    // be reconciled against the real mailbox before a single thread moves.
    destinations: [...new Set(taken.filter((t) => t.action === 'label').map((t) => t.label))],
    queries: rules.map((r) => ({ ruleId: r.id, query: toGmailQuery(r), action: r.action, label: r.label ?? null })),
  };
}

// ── authorising ─────────────────────────────────────────────────────────────

export class NotAuthorised extends Error {}

const VERB = { trash: 'trashed', label: 'moved' };

/**
 * The one rule, as code.
 *
 * `requested` is what the agent intends to do. Every id must appear in the
 * plan **under a rule of the action being authorised**, or this throws and no
 * receipt is written. A thread the plan did not name has, by definition, no
 * rule behind it — which is the exact failure the skill exists to refuse.
 *
 * The action scoping is not decoration. Without it, a plan that authorises
 * filing a thread into "Receipts" would equally authorise trashing it: same
 * thread id, same plan, catastrophically different outcome. An authorisation
 * is for one action on one thread, and the pair is what is checked.
 */
export function authorise(planDoc, requested, action = 'trash') {
  const allowed = new Map(
    (planDoc.taken ?? []).filter((t) => t.action === action).map((t) => [t.threadId, t]),
  );
  const ids = requested ?? [...allowed.keys()];
  const rogue = ids.filter((id) => !allowed.has(id));
  if (rogue.length) {
    // Name the other action when the thread IS in the plan under it — that is
    // the near miss worth calling out, and "not in the plan" would be a lie.
    const misfiled = rogue.filter((id) => (planDoc.taken ?? []).some((t) => t.threadId === id));
    throw new NotAuthorised(
      `${rogue.length} thread(s) not authorised to be ${VERB[action] ?? action}: ${rogue.slice(0, 5).join(', ')}` +
      `${rogue.length > 5 ? ' …' : ''} — every thread that moves must be attributable to a rule` +
      (misfiled.length ? `. ${misfiled.length} of them IS in the plan, under a different action — a plan to file a thread is not a plan to trash it` : ''),
    );
  }
  return ids.map((id) => allowed.get(id));
}

/**
 * The receipt is the undo, so it records what was done and not merely to what.
 *
 * `action`, `label` and `archived` are what make a sort reversible: removing
 * `TRASH` from a thread that was filed rather than trashed would restore
 * nothing and hide the fact that it is still out of the inbox.
 *
 * Entries written by 0.1.0 carry no `action`. They are read as trash, because
 * that is the only thing 0.1.0 could do — an old receipt must still undo.
 */
export const buildReceipt = (entries, { at }) => ({
  at,
  count: entries.length,
  entries: entries.map((e) => ({
    threadId: e.threadId,
    ruleId: e.ruleId,
    action: e.action ?? 'trash',
    label: e.label ?? null,
    archived: e.action === 'label' ? e.archive === true : false,
    from: e.from,
    subject: e.subject,
  })),
});

/**
 * What `undo` must actually reverse, grouped by the operation that reverses it.
 * An entry with no `action` is a 0.1.0 receipt and is read as trash.
 */
export function undoPlan(receipt) {
  const entries = receipt.entries ?? [];
  const untrash = entries.filter((e) => (e.action ?? 'trash') === 'trash');
  const labelled = entries.filter((e) => e.action === 'label');
  const byLabel = new Map();
  for (const e of labelled) {
    if (!byLabel.has(e.label)) byLabel.set(e.label, []);
    byLabel.get(e.label).push(e);
  }
  return {
    untrash,
    unlabel: [...byLabel].map(([label, es]) => ({ label, entries: es })),
    reinbox: labelled.filter((e) => e.archived === true),
    total: entries.length,
  };
}
