/**
 * Planning, proposing, authorising, and undoing.
 *
 * Nothing here talks to Gmail — the MCP is agent-side, so the agent fetches and
 * the agent trashes. What lives here is the part that must not depend on a
 * model behaving well: which threads a rule takes, whether a thread was
 * authorised, and what was actually moved.
 */
import {
  matches, toGmailQuery, normaliseLabel, archives, labelPath, DEFAULT_SCOPE,
  isNearDuplicateLabel, SYSTEM_LABELS,
} from './rules.mjs';

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
export function propose(threads, { minCount = 3, labels = [], rules = [] } = {}) {
  // ── senders an existing rule already has an opinion about ─────────────────
  //
  // Same test `audit` uses, and for the same reason: `ignoreFiled: true`,
  // because a thread already sitting in the folder its rule files into is the
  // MOST claimed thread in the mailbox, not an unclaimed one. Without this,
  // `propose` re-proposes a rule for mail the user already ruled on — and the
  // dangerous half is not the noise. A sender whose mail a SORT rule files can
  // come back as a TRASH candidate, because clustering only ever saw an address
  // and a bulk marker. Observed on a real mailbox: `secure@authentisign.com`
  // was proposed for trashing while `sort-selling-home` was quietly filing the
  // user's real-estate signing documents from that exact address.
  //
  // Claimed at SENDER granularity, not per thread. A rule that claims some of a
  // sender's mail still proves the user has decided about that sender, and the
  // leftover threads are exactly what would otherwise cluster into a trash rule
  // sitting in front of their sort rule.
  const claimedBy = new Map();
  for (const t of threads) {
    const addr = addressOf(t.from);
    if (!addr) continue;
    const rule = (rules ?? []).find((r) => matches(r, t, new Date(), { ignoreFiled: true }));
    if (!rule) continue;
    if (!claimedBy.has(addr)) claimedBy.set(addr, { from: addr, count: 0, ruleIds: new Set() });
    const c = claimedBy.get(addr);
    c.count += 1;
    c.ruleIds.add(rule.id);
  }

  const byAddr = new Map();
  for (const t of threads) {
    const addr = addressOf(t.from);
    if (!addr) continue;
    // Excluded here rather than filtered out of `threads` up front, so
    // `sampled` still reports what was actually read.
    if (claimedBy.has(addr)) continue;
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
  const claimed = [...claimedBy.values()]
    .map((c) => ({ ...c, ruleIds: [...c.ruleIds].sort() }))
    .sort(bySize);

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
        // Must outrank 'nothing-bulk'. A sample your rules already cover in
        // full is the healthy steady state of this skill, and reporting it as
        // "no bulk mail at all — widen the fetch" sends the user to re-fetch a
        // mailbox that is working exactly as intended.
        : claimed.length > 0
          ? { kind: 'all-claimed',
              text: `every sender in the sample is already claimed by one of your ${rules.length} rules. Nothing new has arrived — that is what a covered mailbox looks like.` }
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
        : claimed.length > 0
          ? { kind: 'all-claimed',
              text: `every sender in the sample is already filed by one of your ${rules.length} rules. There is nothing left over to file.` }
          : { kind: 'nothing-to-file',
              text: 'nothing in the sample was withheld from trashing, so there is nothing left over to file.' };

  const unhoused = sortable.filter((s) => s.unhoused).length;

  return {
    candidates, withheld, below, reason, sampled: threads.length,
    sortable, sortReason, unhoused,
    // Reported, never silently dropped. A shrinking candidate table with no
    // stated cause reads as mail having gone missing.
    claimed, claimedThreads: claimed.reduce((n, c) => n + c.count, 0),
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

// ── subdividing ─────────────────────────────────────────────────────────────

/**
 * Match a cluster against the sub-labels a parent folder ALREADY has.
 *
 * Deliberately looser than `matchDestination`, and only here. That function is
 * exact-on-a-whole-segment because it searches the entire label list, where a
 * near match is a coin flip between `Health Insurance` and `Healthcare`. This
 * one searches only the children the user deliberately created under one
 * parent — a handful of names, all about the same subject — so the risk profile
 * is different, and being too strict has its own cost. A sender at
 * `@globexcorp.example` fails an exact match against a `Recruiting/Globex`
 * folder the user already made: the address token is `globexcorp`, the segment
 * flattens to `globex`, and nothing joins them. The cluster comes back as
 * "needs a name" and a second folder gets created beside the first — the exact
 * failure the strictness was meant to prevent.
 *
 * So: prefix containment in either direction, floored at 4 characters on the
 * shorter side. `globex` ⊂ `globexcorp` matches. An initialism does not —
 * `ihi` against `initechhealthinc` shares no prefix, and should not match,
 * because nothing in that address says what the initials stand for. Expanding
 * one is the user's call, not a string comparison's.
 */
export function matchChildLabel(address, children = []) {
  const tokens = addressTokens(address);
  if (tokens.length === 0) return null;
  for (const raw of children) {
    const name = typeof raw === 'string' ? raw : raw?.name ?? raw?.label;
    if (!name) continue;
    const segs = normaliseLabel(name).split('/');
    const leaf = segs[segs.length - 1].replace(/[^a-z0-9]+/g, '');
    if (leaf.length < 4) continue;
    for (const t of tokens) {
      if (t.length < 4) continue;
      if (t === leaf || t.startsWith(leaf) || leaf.startsWith(t)) return name;
    }
  }
  return null;
}

/**
 * Sender domains that host mail for someone else.
 *
 * These are the reason `subdivide` cannot name a sub-label on its own. An
 * applicant tracking system sends on behalf of whichever employer bought it, so
 * `no-reply@ashbyhq.com` carries Obvious and Panorama and forty other companies
 * behind one address. Naming a folder after the domain files every employer
 * into `Recruiting/Ashbyhq` — the same failure as filing a school district
 * under `Parentvendor`, and the same failure the folder split was supposed to fix.
 *
 * The list is not a guard, it is an admission: for these senders the entity is
 * in the SUBJECT, and reading it is judgment. A cluster matching one comes back
 * unhoused with its distinct subjects attached, whatever else is true of it.
 */
export const VENDOR_HOSTS = [
  'ashbyhq', 'greenhouse', 'lever', 'workable', 'smartrecruiters', 'myworkday',
  'workday', 'icims', 'jobvite', 'breezy', 'taleo', 'successfactors',
  'authentisign', 'docusign', 'hellosign', 'intuit', 'quickbooks',
  'sendgrid', 'mailchimp', 'hubspot', 'salesforce',
];

export const vendorHostOf = (address) => {
  const d = domainOf(address) ?? '';
  return VENDOR_HOSTS.find((v) => d.includes(v)) ?? null;
};

/**
 * Split a folder that has grown into several things.
 *
 * `propose` asks "what does this inbox want filed"; this asks the question a
 * folder starts raising once it has mail in it — "is this still one category?"
 * A `Recruiting` folder holding four employers answers "is this job-hunt mail"
 * and nothing more useful, and the mailbox cannot say which employer without
 * reading every thread.
 *
 * Clusters by sender domain rather than by full address, because one employer
 * writes from five people. Matches each cluster against the sub-labels the
 * parent already has, and names nothing it cannot find — same contract as
 * `matchDestination`, for the same reason.
 */
export function subdivide(threads, { parent, labels = [], minCount = 1 } = {}) {
  if (!parent || String(parent).trim() === '') {
    throw new Error('subdivide: name the folder to split with --parent');
  }
  const parentName = String(parent).trim();
  const parentKey = normaliseLabel(parentName);

  // Only the sub-labels of THIS parent are candidate homes. Matching against
  // the whole label list would file a OneCall cluster into an unrelated
  // top-level folder that happens to share a word.
  const children = [];
  for (const raw of labels) {
    const name = typeof raw === 'string' ? raw : raw?.name ?? raw?.label;
    if (!name) continue;
    if (normaliseLabel(name).startsWith(`${parentKey}/`)) children.push(name);
  }

  const byDomain = new Map();
  for (const t of threads) {
    const addr = addressOf(t.from);
    const domain = domainOf(t.from);
    if (!addr || !domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push({ ...t, _addr: addr });
  }

  const clusters = [];
  const below = [];
  for (const [domain, group] of byDomain) {
    const subjects = [...new Set(group.map((t) => String(t.subject ?? '').trim()).filter(Boolean))];
    const vendor = vendorHostOf(group[0]._addr);
    const row = {
      id: `sort-${parentKey.replace(/[^a-z0-9]+/g, '-')}-${domain.replace(/[^a-z0-9]+/g, '-')}`
        .replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''),
      from: `@${domain}`,
      domain,
      count: group.length,
      senders: [...new Set(group.map((t) => t._addr))],
      sample: group[0].subject ?? '',
      subjects,
      vendorHost: vendor,
      // A vendor-hosted cluster is never housed automatically, even when a
      // sub-label happens to share a word with the vendor's domain.
      destination: vendor ? null : matchChildLabel(`@${domain}`, children),
      // Filing already-filed mail must not archive it a second time; and the
      // parent stays on the thread, so a sub-label is purely additive.
      keepInInbox: false,
    };
    if (group.length < minCount) { below.push({ ...row, why: `only ${group.length} in the folder (threshold ${minCount})` }); continue; }
    clusters.push(row);
  }

  for (const c of clusters) c.unhoused = c.destination === null;
  clusters.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
  below.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));

  const reason = clusters.length > 0 ? null
    : below.length > 0
      ? { kind: 'below-threshold',
          text: `nothing in "${parentName}" reached the threshold of ${minCount}. Re-run with a lower \`--min-count\` to see the near misses.` }
      : threads.length === 0
        ? { kind: 'empty-folder',
            text: `"${parentName}" has no mail in the sample — fetch it with \`label:${parentName}\` first, or the folder really is empty.` }
        : { kind: 'no-senders',
            text: 'no thread in the sample carries a parseable sender, so there is nothing to cluster by.' };

  // One entity is not a split. Saying so is the point: a folder whose mail all
  // comes from one place does not want sub-labels, and inventing them produces
  // folders holding one sender each that the user then has to unpick.
  const single = clusters.length === 1 ? clusters[0] : null;

  return {
    parent: parentName,
    clusters,
    below,
    reason,
    single,
    knownChildren: children,
    unhoused: clusters.filter((c) => c.unhoused).length,
    vendorHosted: clusters.filter((c) => c.vendorHost).length,
    sampled: threads.length,
  };
}

/**
 * A subdivide cluster turned into a real rule. Same contract as
 * `candidateToSortRule`: the destination is required and never invented.
 *
 * A vendor-hosted cluster additionally requires a subject matcher, because the
 * sender identifies the vendor and not the entity the folder is named after.
 * Filing every Ashby thread into one employer's folder is worse than not
 * splitting at all — it is mail filed under a name that is actively wrong.
 */
export const clusterToSubRule = (c, destination = c.destination, subjectContains = null) => {
  if (!destination) {
    throw new Error(`subdivide cluster ${c.from} has no destination — name the sub-label before turning it into a rule`);
  }
  if (c.vendorHost && !subjectContains) {
    throw new Error(
      `subdivide cluster ${c.from} is hosted by ${c.vendorHost}, which sends for many organisations — ` +
      'a sender-only rule would file all of them into one folder. Give it a subjectContains naming the organisation.',
    );
  }
  const match = { from: c.from };
  if (subjectContains) match.subjectContains = subjectContains;
  return {
    id: c.id,
    action: 'label',
    label: destination,
    match,
    note: `file mail from ${c.from} — ${c.count} already in ${destination.split('/')[0]}, e.g. "${String(c.sample).slice(0, 60)}"`
      + (c.vendorHost ? ` — ${c.vendorHost} hosts many organisations, so the subject is what names this one` : ''),
  };
};

// ── auditing: is this label system still coherent? ───────────────────────────

/**
 * Every label a rule set files into, as a set of normalised names — including
 * the parents a nested destination implies.
 */
const managedLabels = (ruleDoc) => {
  const out = new Set();
  for (const r of ruleDoc?.rules ?? []) {
    if (r.action !== 'label' || !r.label) continue;
    for (const p of labelPath(r.label)) out.add(normaliseLabel(p));
  }
  return out;
};

/**
 * Audit the label system, which rots in two independent ways.
 *
 * A skill that only ever looks at what its own rules already match cannot see
 * either of them. A folder no rule files into stays sorted exactly as long as
 * the user keeps sorting it by hand; two spellings of one folder split the mail
 * in half and nothing says so. Both are invisible to `plan`, because `plan`
 * only ever asks "what do my rules take" — never "is what I have coherent".
 *
 * `threads` is optional. Without it the mail half is skipped and the label half
 * still answers; a run that only has a label list should still get a report
 * rather than an error.
 */
export function audit(labels = [], ruleDoc = { rules: [] }, threads = null) {
  const managed = managedLabels(ruleDoc);

  const named = [];
  for (const raw of labels) {
    const name = typeof raw === 'string' ? raw : raw?.name ?? raw?.label;
    if (!name) continue;
    const upper = name.toUpperCase();
    // Gmail's own labels are not the user's folders and can never be managed —
    // counting them as unmanaged would report a permanent, unfixable finding.
    if (SYSTEM_LABELS.includes(upper) || upper.startsWith('CATEGORY_')) continue;
    named.push({
      name,
      threads: typeof raw === 'object' ? (raw.threadsTotal ?? raw.threads ?? null) : null,
      ruleIds: (ruleDoc.rules ?? [])
        .filter((r) => r.action === 'label' && r.label && labelPath(r.label).some((p) => normaliseLabel(p) === normaliseLabel(name)))
        .map((r) => r.id),
    });
  }

  for (const l of named) {
    l.managed = managed.has(normaliseLabel(l.name));
    l.nearDuplicateOf = named.filter((o) => o !== l && isNearDuplicateLabel(l.name, o.name)).map((o) => o.name);
    // An empty folder no rule files into is scaffolding someone made once —
    // distinguished from an unmanaged folder holding real mail, because the
    // remedies are opposite: delete the first, write a rule for the second.
    //
    // Tri-state on purpose. A label list without `threadsTotal` — a
    // hand-written one, or an older fetch — cannot say which, and reporting
    // "holds mail" from a missing field would tell the user to write rules for
    // folders that are empty. Not knowing is a third answer, and it is said out
    // loud rather than guessed.
    l.empty = l.threads === null ? null : l.threads === 0;
  }

  const unmanaged = named.filter((l) => !l.managed);
  const duplicates = named.filter((l) => l.nearDuplicateOf.length);

  // ── the mail half ─────────────────────────────────────────────────────────
  let unclaimed = null;
  if (Array.isArray(threads)) {
    // NOT `plan`. `plan` asks "is there work to do", and answers no for a
    // thread already sitting in the folder its rule files into — which is the
    // most claimed thread in the mailbox, not an unclaimed one. `ignoreFiled`
    // asks the question this command actually has: does any rule claim it?
    const rules = ruleDoc?.rules ?? [];
    const rest = threads.filter((t) => !rules.some((r) => matches(r, t, new Date(), { ignoreFiled: true })));

    const byAddr = new Map();
    for (const t of rest) {
      const addr = addressOf(t.from);
      if (!addr) continue;
      if (!byAddr.has(addr)) byAddr.set(addr, []);
      byAddr.get(addr).push(t);
    }
    const clusters = [...byAddr.entries()].map(([addr, group]) => ({
      from: addr,
      count: group.length,
      sample: group[0].subject ?? '',
      // An existing label whose name the sender matches. Same exact-segment
      // contract as `matchDestination`: a near match across every folder the
      // user owns is a coin flip, and a folder chosen by coin flip is worse
      // than none.
      destination: matchDestination(addr, named.map((l) => l.name)),
      vendorHost: vendorHostOf(addr),
      inInbox: group.some((t) => inInbox(t)),
    })).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
    for (const c of clusters) c.unhoused = c.destination === null;

    unclaimed = {
      threads: rest.length,
      scanned: threads.length,
      clusters,
      // The parents a new cluster could nest under, printed beside the
      // unhoused ones so a new employer's mail is proposed as
      // `Recruiting/<name>` rather than as another top-level folder. This is
      // the difference between a label system that grows and one that sprawls.
      parents: named.filter((l) => !l.name.includes('/')).map((l) => l.name),
    };
  }

  return {
    labels: named,
    managed: named.filter((l) => l.managed).length,
    unmanaged,
    duplicates,
    unclaimed,
    // The one number worth watching. A system at 100% is one where every folder
    // stays sorted without the user touching it.
    coverage: named.length ? Math.round((named.filter((l) => l.managed).length / named.length) * 100) : 100,
    clean: unmanaged.length === 0 && duplicates.length === 0 && (unclaimed?.threads ?? 0) === 0,
  };
}

/**
 * Fold one label into another, as an ordered list of operations.
 *
 * Order is the whole of it: the target label goes on BEFORE the source comes
 * off. Reversed, every thread spends the gap between two API calls in neither
 * folder — and if the run dies in that gap, the mail is in neither folder
 * permanently, with a receipt describing a mailbox that no longer exists.
 *
 * A merge that moves no mail is still a merge. `Reciepts` held one thread that
 * already carried `Receipts`, so the whole operation was "remove the label,
 * delete the folder" — and it still has to be recorded, or it cannot be undone.
 */
export function mergeLabels(threads, { from, to }) {
  if (!from || !to) throw new Error('merge: name both --from and --to');
  const src = normaliseLabel(from);
  const dst = normaliseLabel(to);
  if (src === dst) throw new Error(`merge: "${from}" and "${to}" are the same label`);
  if (labelPath(to).some((p) => normaliseLabel(p) === src)) {
    throw new Error(`merge: "${from}" is a parent of "${to}" — merging a folder into its own child would leave the child holding mail its parent no longer names`);
  }

  const carrying = (threads ?? []).filter((t) => (t.labels ?? []).some((l) => normaliseLabel(l) === src));
  const needsTarget = carrying.filter((t) => !(t.labels ?? []).some((l) => normaliseLabel(l) === dst));

  return {
    from, to,
    // apply `to` first, then remove `from` — never the other way round
    label: needsTarget.map((t) => ({ threadId: t.id, from: t.from, subject: t.subject })),
    unlabel: carrying.map((t) => ({ threadId: t.id, from: t.from, subject: t.subject })),
    alreadyThere: carrying.length - needsTarget.length,
    total: carrying.length,
  };
}

/** A merge turned into receipt entries, so `undo` can put the label back. */
export const mergeReceiptEntries = (m) => m.unlabel.map((e) => ({
  threadId: e.threadId,
  ruleId: `merge:${m.from}→${m.to}`,
  action: 'unlabel',
  label: m.from,
  // What the merge ADDED, so undo removes only that and restores `from`.
  added: m.label.some((x) => x.threadId === e.threadId) ? [m.to] : [],
  removed: [m.from],
  archived: false,
  from: e.from,
  subject: e.subject,
}));

// ── planning ────────────────────────────────────────────────────────────────

/**
 * Exactly which threads each rule takes. `keep` wins over everything: a thread
 * a keep rule claims is never trashed, whatever else matched it.
 */
/**
 * Which labels in a rule's destination path the thread does not already carry.
 *
 * Falls back to the whole path when the fetch supplied no resolved label names
 * — the skill cannot claim a thread already has a label it was never told
 * about, and re-applying one is idempotent in Gmail.
 */
const newLabelsFor = (rule, thread) => {
  const path = labelPath(rule.label);
  if (!Array.isArray(thread.labels) || thread.labels.length === 0) return path;
  const have = new Set(thread.labels.map((l) => normaliseLabel(l)));
  return path.filter((l) => !have.has(normaliseLabel(l)));
};

/** Is this thread currently in the inbox, as far as the fetch could tell? */
const inInbox = (t) => {
  const ids = [...(t.labelIds ?? []), ...(t.labels ?? [])].map((l) => String(l).toUpperCase());
  // A fetch that supplied no labels at all cannot say otherwise, and the
  // historical scope of this skill is the inbox — so absence means "yes".
  return ids.length === 0 ? true : ids.includes('INBOX');
};

export function plan(threads, ruleDoc, { now = new Date(), scope = DEFAULT_SCOPE } = {}) {
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
        // Every label the destination implies, outermost first — the parent
        // stays on the thread, so a sub-label adds to the path rather than
        // replacing it.
        labels: r.action === 'label' ? labelPath(r.label) : [],
        // …and of those, the ones this run would actually put on the thread.
        // The distinction is the whole of `undo`: a retroactive pass that adds
        // `Recruiting/Globex` to mail already carrying `Recruiting` must not
        // strip `Recruiting` when it is reversed. Only computable when the
        // fetch resolved label names; without them the two are the same list,
        // which is what this skill did before nesting existed.
        adds: r.action === 'label' ? newLabelsFor(r, t) : [],
        // A rule that archives cannot archive a thread that is already out of
        // the inbox. Reporting otherwise inflates the one number the user
        // actually reads — "would leave the inbox" — on exactly the run where
        // it should be zero: a retroactive pass over mail already filed.
        archive: archives(r) && inInbox(t),
        // What the RULE wanted, separately from what this thread allows. The
        // two reasons a thread is not archived are not interchangeable: one is
        // a rule saying "tag it in place", the other is a thread that already
        // left the inbox, and reporting the second as the first tells a
        // retroactive run that 13 threads are staying in an inbox none of them
        // were in.
        wouldArchive: archives(r),
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
    scope,
    taken,
    spared,
    overlaps,
    // Every distinct folder this plan would file into — including the parents
    // a nested destination implies — so the destinations can be reconciled
    // against the real mailbox before a single thread moves.
    destinations: [...new Set(taken.filter((t) => t.action === 'label').flatMap((t) => t.labels ?? [t.label]))],
    queries: rules.map((r) => ({ ruleId: r.id, query: toGmailQuery(r, { scope }), action: r.action, label: r.label ?? null })),
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
    // Exactly the labels this run PUT on the thread, which is not the same as
    // the labels the thread ends up with. Filing into `Recruiting/Globex`
    // mail that already sat in `Recruiting` adds one label, and an undo that
    // removed both would take away a label the user filed by hand.
    added: e.action === 'label' ? (e.adds ?? (e.label ? [e.label] : [])) : (e.added ?? []),
    // Labels this run took OFF the thread, which only a merge does. Recorded
    // for the same reason `added` is: an undo has to know what to put back, and
    // "the rule's destination" does not answer that.
    removed: e.removed ?? [],
    archived: e.action === 'label' ? e.archive === true : false,
    from: e.from,
    subject: e.subject,
  })),
});

/**
 * What `undo` must actually reverse, grouped by the operation that reverses it.
 * An entry with no `action` is a 0.1.0 receipt and is read as trash.
 *
 * Grouped by the labels the run ADDED, not by the rule's destination — a
 * receipt written before nesting existed carries no `added`, and falls back to
 * its single `label`, so an old receipt still undoes.
 */
export function undoPlan(receipt) {
  const entries = receipt.entries ?? [];
  const untrash = entries.filter((e) => (e.action ?? 'trash') === 'trash');
  const labelled = entries.filter((e) => e.action === 'label');
  const merged = entries.filter((e) => e.action === 'unlabel');

  const byLabel = new Map();
  // Both kinds of entry can have ADDED a label, and both must have it taken
  // back off — a merge adds the target folder to every thread that lacked it.
  for (const e of [...labelled, ...merged]) {
    const added = Array.isArray(e.added) && e.added.length
      ? e.added
      : (e.action === 'label' && e.label ? [e.label] : []);
    // Innermost first: removing a parent while a child of it is still on the
    // thread leaves the thread filed under a folder Gmail will keep showing.
    for (const label of [...added].reverse()) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(e);
    }
  }

  // Labels a merge took OFF. Reversing that is putting them back — and the
  // folder itself may have been deleted, so `undo` has to say so rather than
  // emit a `label_thread` call against a label id that no longer exists.
  const byRestore = new Map();
  for (const e of merged) {
    for (const label of e.removed ?? (e.label ? [e.label] : [])) {
      if (!byRestore.has(label)) byRestore.set(label, []);
      byRestore.get(label).push(e);
    }
  }

  return {
    untrash,
    unlabel: [...byLabel].map(([label, es]) => ({ label, entries: es })),
    relabel: [...byRestore].map(([label, es]) => ({ label, entries: es })),
    reinbox: labelled.filter((e) => e.archived === true),
    total: entries.length,
  };
}
