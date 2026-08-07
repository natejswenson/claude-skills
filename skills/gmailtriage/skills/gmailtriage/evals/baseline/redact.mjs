/**
 * Turn a real inbox fetch into a corpus safe to commit to a public repo.
 *
 * What is kept is the SHAPE that the code reasons about — cluster sizes, the
 * category mix, which senders trip which guard. What is removed is anything
 * that identifies a person or a mailbox: thread ids become stable hashes, human
 * senders and their subjects go entirely, and role addresses keep only enough
 * to stay recognisable as bulk mail.
 *
 *   node evals/baseline/redact.mjs <real.json> <out.json>
 *   node evals/baseline/redact.mjs --labels <list_labels.json> <out.json>
 *
 * The result is a real run's shape with the identities replaced — which is what
 * the golden pins. It is not a verbatim copy of a mailbox, and it must not be
 * described as one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const h = (s, n = 12) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);

/** Senders that are companies sending role mail, not people. */
const ROLE = /^(no-?reply|noreply|support|success|marketing|alerts?|notifications?|careers|info|do-not-reply|invoice|billing|authorservices|workspace-noreply|mychartmessage|paymentmessage)[^@]*@/i;

/**
 * Domains whose guard behaviour is the point of the corpus, so they stay.
 *
 * **An employer the mailbox owner is talking to is never on this list.** A
 * sender domain that is a product — a registry, a retailer, a mail vendor —
 * says nothing about a person. A sender domain that is a company someone is
 * interviewing with publishes their job search to a public repo, permanently
 * and indexed, and no test needs it: what the code reasons about is that seven
 * threads share a domain, never which domain. One employer domain was on this
 * list until 0.3.0 and should not have been.
 */
const KEEP_DOMAIN = [
  /npmjs\.com$/, /rocketreach\.co$/, /fedex\.com$/, /github\.com$/, /glassdoor\.com$/,
  /goodreads\.com$/, /packtpub\.com$/, /typefully\.com$/, /google\.com$/, /api\.bible$/,
  /tractive\.com$/,
  // the guard cases — these must survive or the corpus stops testing the guards
  /fidelity\.com$/, /wellsfargo\.com$/, /sanfordhealth\.org$/, /onlinejmc\.com$/,
  // Applicant tracking VENDORS, kept deliberately: `subdivide` matches these
  // names to decide a cluster cannot be named from its sender, so a pseudonym
  // here would stop the vendor guard firing and the corpus would test nothing.
  // They name a piece of software, not an employer — and the subject, which is
  // where the employer's name actually is, is redacted below.
  /workablemail\.com$/, /ashbyhq\.com$/,
];

const keepDomain = (d) => KEEP_DOMAIN.some((re) => re.test(d));

/** Is this address one an applicant tracking system sends from? */
const VENDOR_DOMAIN = [/workablemail\.com$/, /ashbyhq\.com$/, /greenhouse\.io$/, /lever\.co$/];
const isVendorDomain = (d) => VENDOR_DOMAIN.some((re) => re.test(d));

/**
 * A stable pseudonym for a domain that must not be named.
 *
 * The DOMAIN is what has to survive, not the name of it. `subdivide` clusters
 * by domain, so collapsing every unkept sender to one `example.invalid` — which
 * is what this did before 0.3.0 — merges four employers into a single cluster
 * and the fixture stops testing the thing it exists for.
 */
const seenDomains = new Map();
const pseudoDomain = (domain) => {
  if (!seenDomains.has(domain)) {
    seenDomains.set(domain, `org-${String.fromCharCode(97 + seenDomains.size)}-${h(domain, 4)}.example`);
  }
  return seenDomains.get(domain);
};

let people = 0;
const seenPeople = new Map();

function redactSender(from) {
  const at = String(from).lastIndexOf('@');
  if (at < 0) return `unknown-${h(from, 6)}@example.invalid`;
  const local = from.slice(0, at);
  const domain = from.slice(at + 1).toLowerCase();

  if (ROLE.test(from) && keepDomain(domain)) return `${local.toLowerCase()}@${domain}`;
  if (keepDomain(domain)) return `sender-${h(local, 6)}@${domain}`;

  // A person, or an organisation that must not be named: the local part is
  // replaced and the domain pseudonymised, both stably, so per-sender counts
  // AND per-domain clusters both stay real.
  if (!seenPeople.has(from)) seenPeople.set(from, `person${++people}@${pseudoDomain(domain)}`);
  return seenPeople.get(from);
}

const isPerson = (redacted) => /^(person\d+|unknown-)/.test(redacted);

/**
 * A subject, redacted according to what it can leak.
 *
 * Three cases, and the middle one is the one that bites. Role mail from a
 * product keeps its subject, because the credential guard matches on it. A
 * person's subject is their business. And a subject on mail from an applicant
 * tracking system is, by construction, the name of the employer that system is
 * sending for — "Thanks for applying to <employer>" — so keeping the vendor
 * domain while keeping the subject publishes exactly what pseudonymising the
 * domain was for. Those become stable placeholders that still differ per
 * organisation, so the "distinct subjects in the folder" signal survives.
 */
const seenVendorSubjects = new Map();
function redactSubject(subject, redactedFrom, domain) {
  if (isPerson(redactedFrom)) return '(personal thread)';
  if (isVendorDomain(domain)) {
    if (!seenVendorSubjects.has(subject)) {
      seenVendorSubjects.set(subject, `Thanks for applying to Organisation ${String.fromCharCode(65 + seenVendorSubjects.size)}`);
    }
    return seenVendorSubjects.get(subject);
  }
  return String(subject ?? '').slice(0, 90);
}

/**
 * The user's own folder names, redacted.
 *
 * Folder names are personal in a way domains are not — "Sell_Cabin" and
 * "Selling_Home" say something about someone's finances that no sender address
 * does. So only the folders whose behaviour the corpus is testing survive
 * verbatim; the rest become stable, meaningless names that keep the COUNT real.
 *
 * `Receipts` and `Reciepts` are kept deliberately and are not a typo here: this
 * mailbox really does have both, and a near-duplicate spelling is exactly the
 * case the destination matcher must not collapse or silently pick between.
 */
const KEEP_LABEL = new Set([
  'Receipts', 'Reciepts', 'Financial Advisor',
  'Cleanup', 'Cleanup/Promotions', 'Cleanup/Newsletters',
  // The destinations the frozen rule set files into. Generic by construction —
  // they were named during the run, not carried over from a private mailbox —
  // and the golden is unreadable if they arrive as "Folder a91c".
  'Job Search', 'Investments', 'Banking', 'School',
  // The parent of the sub-label corpus. A category name, not an organisation:
  // "Recruiting" says someone gets recruiting mail, which every mailbox does.
  // Its CHILDREN are employers and are never kept — see the per-segment
  // redaction below.
  'Recruiting',
]);

/**
 * A pure function of the name, deliberately — NOT a counter.
 *
 * The label list and the per-thread `labels` arrays are redacted in separate
 * passes, so a counter gives them different answers and a real folder name
 * ("Vision Realty") survives on a thread while being renamed in the list. Which
 * is exactly what happened the first time this ran.
 *
 * Redacted **per segment**, so nesting survives. `Recruiting/One Call` becomes
 * `Recruiting/Folder ab12`, not `Folder cd34` — a whole-name hash would flatten
 * the parent/child relationship, which is the entire thing the sub-label
 * corpus exists to pin.
 */
const redactLabelName = (name) => {
  // System labels stay verbatim: the filter that drops them is the thing being
  // tested, and a renamed INBOX would test nothing.
  if (/^(CHAT|SENT|INBOX|IMPORTANT|TRASH|DRAFT|SPAM|STARRED|UNREAD)$/.test(name)) return name;
  if (name.startsWith('CATEGORY_')) return name;
  if (KEEP_LABEL.has(name)) return name;
  if (name.includes('/')) {
    const segs = name.split('/');
    return segs
      .map((_, i) => {
        const path = segs.slice(0, i + 1).join('/');
        return KEEP_LABEL.has(path) ? segs[i] : `Folder ${h(path, 4)}`;
      })
      .join('/');
  }
  return `Folder ${h(name, 4)}`;
};

/** The redacted id for one label, so both passes agree on it. */
const redactLabelId = (id, name) => (redactLabelName(name) === name && id ? id : `Label_${h(id ?? name, 8)}`);

function redactLabels(raw) {
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  return {
    labels: list.map((l) => {
      const name = typeof l === 'string' ? l : l?.name ?? l?.label;
      const id = typeof l === 'string' ? null : l?.labelId ?? l?.id ?? null;
      if (!name) return null;
      return {
        labelId: redactLabelId(id, name),
        name: redactLabelName(name),
        // A thread COUNT identifies nobody, and `audit` needs it to tell an
        // unmanaged folder holding real mail from empty scaffolding — the two
        // want opposite remedies. Dropping it made every frozen label report
        // "count unknown", so the classification the golden exists to pin was
        // never exercised.
        ...(typeof l === 'object' && l.threadsTotal !== undefined ? { threadsTotal: l.threadsTotal } : {}),
      };
    }).filter(Boolean),
  };
}

/**
 * id → {id, name}, both redacted, from the real `list_labels` output.
 *
 * Without this the two passes disagree: a thread keeps its real `Label_15`
 * while the label list renames that id, so the frozen corpus describes a
 * mailbox where no thread's labels resolve to anything. The corpus still
 * *looks* complete — which is the worst kind of broken fixture.
 */
function labelMap(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  const map = new Map();
  for (const l of list) {
    const name = typeof l === 'string' ? l : l?.name ?? l?.label;
    const id = typeof l === 'string' ? l : l?.labelId ?? l?.id ?? null;
    if (name) map.set(id ?? name, { id: redactLabelId(id, name), name: redactLabelName(name), original: name });
  }
  return map;
}

/**
 * Redact a RULE file, using the same mappings the corpus got.
 *
 * A rule set is not a mailbox, but it names the same senders and the same
 * folders — so redacting the corpus and leaving the rules verbatim produces a
 * fixture where no rule matches anything, and an audit golden over it reports
 * a mailbox with zero coverage that looks like a real finding.
 *
 * Requires `--labels-from`, since a rule's destination has to redact to
 * whatever the label list called it.
 */
function redactRules(doc, known) {
  const rules = (doc.rules ?? []).map((r) => {
    const out = { ...r };
    // An id and a note are prose the user wrote, and both name organisations
    // freely — `sort-uhg-applications`, "Omega Exteriors invoices via
    // QuickBooks". Redacting only the matcher and the destination left every
    // one of them in the corpus AND in the audit golden, which prints rule ids
    // in its "Filed into by" column.
    //
    // The action prefix survives because it carries meaning the golden is
    // read for; the rest is a stable hash of the original id.
    const prefix = /^(sort|trash|keep)-/.exec(r.id ?? '')?.[1] ?? 'rule';
    out.id = `${prefix}-${h(r.id ?? '', 6)}`;
    out.note = `${r.action} rule, redacted — the original note named an organisation`;
    if (r.label) {
      const hit = [...known.values()].find((v) => v.original === r.label);
      out.label = hit ? hit.name : redactLabelName(r.label);
    }
    if (r.match?.from) {
      // A rule matches a substring of an address, so it may be a bare domain
      // (`@acme.com`) rather than a whole address. Redact whichever it is
      // through the same maps the corpus used, so the two still agree.
      const raw = String(r.match.from);
      const at = raw.lastIndexOf('@');
      const domain = (at >= 0 ? raw.slice(at + 1) : raw).toLowerCase();
      const local = at > 0 ? raw.slice(0, at) : '';
      if (keepDomain(domain)) out.match = { ...r.match, from: raw.toLowerCase() };
      else {
        const d = seenDomains.get(domain) ?? pseudoDomain(domain);
        // A whole address maps to the person pseudonym the corpus gave it;
        // a bare domain keeps the `@` so it still matches every sender there.
        const whole = [...seenPeople.entries()].find(([k]) => k.toLowerCase() === raw.toLowerCase());
        out.match = { ...r.match, from: whole ? whole[1] : `${local ? '' : '@'}${local ? `${local}@${d}` : d}` };
      }
      // A rule that matches on a SUBJECT cannot survive subject redaction: the
      // subjects it was written against are now "(personal thread)" or a
      // placeholder, so the rule matches nothing and the fixture reports mail
      // as unclaimed that the real mailbox files perfectly well — a finding
      // that looks real and is an artifact of redaction.
      //
      // The sender constraint is kept and the subject one dropped. That widens
      // the rule INSIDE THE FIXTURE ONLY, which is sound here because within a
      // pseudonymised corpus the sender already identifies the cluster.
      // `.example` covers both forms a redacted sender takes — the person
      // pseudonym `personN@org-a.example` and the bare-domain `@org-a.example`
      // a domain rule becomes. Checking only the first left every domain rule's
      // subject matcher in place, pointing at subjects that no longer exist.
      const subjectWasRedacted = /\.example$/.test(out.match.from) || isVendorDomain(domain);
      if (subjectWasRedacted && out.match.subjectContains) {
        const { subjectContains, ...rest } = out.match;
        out.match = rest;
        // `out.note`, never `r.note` — the original was already replaced above,
        // and reaching back for it puts every redacted organisation name
        // straight back into the corpus.
        out.note = `${out.note} [fixture: subject matcher dropped — the corpus subjects are redacted]`;
      }
    }
    return out;
  });
  return { ...doc, rules };
}

const argv = process.argv.slice(2);
const labelsMode = argv[0] === '--labels';
// Flag pairs, stripped out before the two positional arguments are read.
//
// `--labels-from` resolves each thread's opaque label ids through the SAME
// redaction the label list gets, so the two halves of the corpus describe one
// mailbox. `--rules-in`/`--rules-out` redact a rule set **in the same process**,
// after the threads — which is the only way it can reuse their sender and
// folder pseudonyms. Redacting the two separately produces a rule set that
// matches nothing, and an audit golden over that reports zero coverage while
// looking like a real finding.
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const labelsFrom = flag('--labels-from');
const rulesIn = flag('--rules-in');
const rulesOut = flag('--rules-out');
const FLAGS = ['--labels-from', '--rules-in', '--rules-out'];
const args = argv.filter((a, i) => !FLAGS.includes(a) && !FLAGS.includes(argv[i - 1]));
const [src, out] = labelsMode ? args.slice(1) : args;
if (!src || !out) {
  console.error('usage: redact.mjs [--labels] [--labels-from <list_labels.json>]');
  console.error('                  [--rules-in <rules.json> --rules-out <out.json>] <real.json> <out.json>');
  process.exit(2);
}
if ((rulesIn || rulesOut) && (!rulesIn || !rulesOut || labelsMode || !labelsFrom)) {
  console.error('redact.mjs: --rules-in and --rules-out go together, need --labels-from, and run with the THREAD pass');
  process.exit(2);
}

if (labelsMode) {
  const doc = redactLabels(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${doc.labels.length} labels · ${doc.labels.filter((l) => /^Folder /.test(l.name)).length} renamed`);
  process.exit(0);
}

const known = labelsFrom ? labelMap(labelsFrom) : null;

const threads = JSON.parse(readFileSync(src, 'utf8')).map((t, i) => {
  const from = redactSender(t.from);
  const domain = String(t.from ?? '').slice(String(t.from ?? '').lastIndexOf('@') + 1).toLowerCase();
  const ids = t.labelIds ?? [];
  return {
    id: `thr-${h(t.id, 10)}`,
    from,
    subject: redactSubject(t.subject, from, domain),
    date: t.date,
    labelIds: known ? ids.map((id) => known.get(id)?.id ?? id) : ids,
    // Resolved label NAMES. Carried through because "this thread is already
    // filed there" is what stops a sort rule re-taking it every run, and a
    // corpus without the field cannot test that a retroactive pass converges.
    ...(Array.isArray(t.labels)
      ? { labels: t.labels.map(redactLabelName) }
      : known ? { labels: ids.map((id) => known.get(id)?.name ?? id) } : {}),
    category: t.category ?? null,
    hasUnsubscribe: !!t.hasUnsubscribe,
  };
});

writeFileSync(out, JSON.stringify(threads, null, 2) + '\n');
const persons = new Set(threads.filter((t) => isPerson(t.from)).map((t) => t.from)).size;
console.log(`${threads.length} threads · ${persons} human senders replaced · ids hashed`);

// After the threads, never before: the rule pass reuses the maps they built.
if (rulesIn) {
  const doc = redactRules(JSON.parse(readFileSync(rulesIn, 'utf8')), known);
  writeFileSync(rulesOut, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${doc.rules.length} rules redacted against the same senders and folders`);
}
