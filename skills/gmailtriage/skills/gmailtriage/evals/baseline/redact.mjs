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

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error('usage: redact.mjs <real.json> <out.json>');
  process.exit(2);
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
    category: t.category ?? null,
    hasUnsubscribe: !!t.hasUnsubscribe,
  };
});

writeFileSync(out, JSON.stringify(threads, null, 2) + '\n');
const persons = new Set(threads.filter((t) => isPerson(t.from)).map((t) => t.from)).size;
console.log(`${threads.length} threads · ${persons} human senders replaced · ids hashed`);
