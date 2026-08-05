/**
 * Planning, proposing, authorising, and undoing.
 *
 * Nothing here talks to Gmail — the MCP is agent-side, so the agent fetches and
 * the agent trashes. What lives here is the part that must not depend on a
 * model behaving well: which threads a rule takes, whether a thread was
 * authorised, and what was actually moved.
 */
import { matches, toGmailQuery } from './rules.mjs';

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
 * Cluster a real inbox sample into candidate rules. Counts come from the
 * sample, so they are evidence of bulk, not a promise about the mailbox.
 */
export function propose(threads, { minCount = 3 } = {}) {
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
    if (isProtected(addr)) { withheld.push({ ...row, why: 'sender looks financial, medical, educational, governmental or recruiting' }); continue; }
    if (hasProtectedSubject(group)) { withheld.push({ ...row, why: 'cluster contains a login code, receipt or verification you cannot lose' }); continue; }
    // The bulk check comes BEFORE the threshold check on purpose. Reversed, a
    // person with two threads lands in `below`, and the "closest sender" table
    // then invites the user to lower the threshold to catch their own realtor.
    // `below` must only ever hold senders that would really become candidates.
    if (bulk === 0) { withheld.push({ ...row, why: 'no bulk-mail marker — may be a person, not a sender' }); continue; }
    if (group.length < minCount) { below.push({ ...row, why: `only ${group.length} in the sample (threshold ${minCount})` }); continue; }
    candidates.push(row);
  }

  const bySize = (a, b) => b.count - a.count || a.from.localeCompare(b.from);
  candidates.sort(bySize);
  withheld.sort(bySize);
  below.sort(bySize);

  // An empty candidate list is a result, not a failure — but only if it says
  // which of the three reasons produced it. A bare empty table reads as "the
  // skill is broken".
  const reason = candidates.length > 0 ? null
    : below.length > 0
      ? { kind: 'below-threshold', best: below[0].count, minCount,
          text: `no sender reached the threshold of ${minCount}. The largest unguarded cluster has ${below[0].count} (${below[0].from}) — re-run with --min-count ${below[0].count} to see it.` }
      : withheld.length > 0
        ? { kind: 'all-withheld',
            text: `every sender in the sample was withheld by a guard. That is the safe answer, not a broken one — read the withheld table and write a rule by hand for anything you disagree with.` }
        : { kind: 'nothing-bulk',
            text: 'no bulk mail in the sample at all. Widen the fetch, or this inbox is already clean.' };

  return { candidates, withheld, below, reason, sampled: threads.length };
}

/** A candidate turned into a real rule object, ready for validation. */
export const candidateToRule = (c) => ({
  id: c.id,
  action: 'trash',
  match: { from: c.from, hasUnsubscribe: true },
  note: `bulk mail from ${c.from} — ${c.count} in the sample, e.g. "${String(c.sample).slice(0, 60)}"`,
});

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
      taken.push({ ruleId: r.id, action: r.action, threadId: t.id, from: t.from, subject: t.subject });
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
    queries: rules.map((r) => ({ ruleId: r.id, query: toGmailQuery(r) })),
  };
}

// ── authorising ─────────────────────────────────────────────────────────────

export class NotAuthorised extends Error {}

/**
 * The one rule, as code.
 *
 * `requested` is what the agent intends to trash. Every id must appear in the
 * plan under a trash rule, or this throws and no receipt is written. A thread
 * the plan did not name has, by definition, no rule behind it — which is the
 * exact failure the skill exists to refuse.
 */
export function authorise(planDoc, requested) {
  const allowed = new Map(
    (planDoc.taken ?? []).filter((t) => t.action === 'trash').map((t) => [t.threadId, t]),
  );
  const ids = requested ?? [...allowed.keys()];
  const rogue = ids.filter((id) => !allowed.has(id));
  if (rogue.length) {
    throw new NotAuthorised(
      `${rogue.length} thread(s) not named by the plan: ${rogue.slice(0, 5).join(', ')}` +
      `${rogue.length > 5 ? ' …' : ''} — every trashed thread must be attributable to a rule`,
    );
  }
  return ids.map((id) => allowed.get(id));
}

export const buildReceipt = (entries, { at }) => ({
  at,
  count: entries.length,
  entries: entries.map((e) => ({ threadId: e.threadId, ruleId: e.ruleId, from: e.from, subject: e.subject })),
});
