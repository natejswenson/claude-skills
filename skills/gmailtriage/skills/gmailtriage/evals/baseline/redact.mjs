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

/** Domains whose guard behaviour is the point of the corpus, so they stay. */
const KEEP_DOMAIN = [
  /npmjs\.com$/, /rocketreach\.co$/, /fedex\.com$/, /github\.com$/, /glassdoor\.com$/,
  /goodreads\.com$/, /packtpub\.com$/, /typefully\.com$/, /google\.com$/, /api\.bible$/,
  /tractive\.com$/,
  // the guard cases — these must survive or the corpus stops testing the guards
  /fidelity\.com$/, /wellsfargo\.com$/, /sanfordhealth\.org$/, /uhg\.com$/,
  /onlinejmc\.com$/, /workablemail\.com$/, /ashbyhq\.com$/,
];

const keepDomain = (d) => KEEP_DOMAIN.some((re) => re.test(d));

let people = 0;
const seenPeople = new Map();

function redactSender(from) {
  const at = String(from).lastIndexOf('@');
  if (at < 0) return `unknown-${h(from, 6)}@example.invalid`;
  const local = from.slice(0, at);
  const domain = from.slice(at + 1).toLowerCase();

  if (ROLE.test(from) && keepDomain(domain)) return `${local.toLowerCase()}@${domain}`;
  if (keepDomain(domain)) return `sender-${h(local, 6)}@${domain}`;

  // a human: replaced entirely, and stably so counts stay real
  if (!seenPeople.has(from)) seenPeople.set(from, `person${++people}@example.invalid`);
  return seenPeople.get(from);
}

const isPerson = (redacted) => redacted.endsWith('@example.invalid');

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
]);

/**
 * A pure function of the name, deliberately — NOT a counter.
 *
 * The label list and the per-thread `labels` arrays are redacted in separate
 * passes, so a counter gives them different answers and a real folder name
 * ("Vision Realty") survives on a thread while being renamed in the list. Which
 * is exactly what happened the first time this ran.
 */
const redactLabelName = (name) => {
  // System labels stay verbatim: the filter that drops them is the thing being
  // tested, and a renamed INBOX would test nothing.
  if (/^(CHAT|SENT|INBOX|IMPORTANT|TRASH|DRAFT|SPAM|STARRED|UNREAD)$/.test(name)) return name;
  if (name.startsWith('CATEGORY_')) return name;
  if (KEEP_LABEL.has(name)) return name;
  return `Folder ${h(name, 4)}`;
};

function redactLabels(raw) {
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  return {
    labels: list.map((l) => {
      const name = typeof l === 'string' ? l : l?.name ?? l?.label;
      const id = typeof l === 'string' ? null : l?.labelId ?? l?.id ?? null;
      if (!name) return null;
      const redacted = redactLabelName(name);
      return {
        labelId: redacted === name && id ? id : `Label_${h(id ?? name, 8)}`,
        name: redacted,
      };
    }).filter(Boolean),
  };
}

const args = process.argv.slice(2);
const labelsMode = args[0] === '--labels';
const [src, out] = labelsMode ? args.slice(1) : args;
if (!src || !out) {
  console.error('usage: redact.mjs [--labels] <real.json> <out.json>');
  process.exit(2);
}

if (labelsMode) {
  const doc = redactLabels(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${doc.labels.length} labels · ${doc.labels.filter((l) => /^Folder /.test(l.name)).length} renamed`);
  process.exit(0);
}

const threads = JSON.parse(readFileSync(src, 'utf8')).map((t, i) => {
  const from = redactSender(t.from);
  return {
    id: `thr-${h(t.id, 10)}`,
    from,
    // A person's subject line is their business. Role mail keeps its subject
    // because the credential guard matches on it.
    subject: isPerson(from) ? '(personal thread)' : String(t.subject ?? '').slice(0, 90),
    date: t.date,
    labelIds: t.labelIds,
    // Resolved label NAMES, when the fetch supplied them. Carried through
    // because "this thread is already filed there" is what stops a sort rule
    // re-taking it every run, and a corpus without the field cannot test it.
    ...(Array.isArray(t.labels) ? { labels: t.labels.map(redactLabelName) } : {}),
    category: t.category ?? null,
    hasUnsubscribe: !!t.hasUnsubscribe,
  };
});

writeFileSync(out, JSON.stringify(threads, null, 2) + '\n');
const persons = new Set(threads.filter((t) => isPerson(t.from)).map((t) => t.from)).size;
console.log(`${threads.length} threads · ${persons} human senders replaced · ids hashed`);
