# Changelog

All notable changes to the **gmailtriage** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-07

### Added

- **`audit` — is this label system still coherent?** Every other command here
  asks *"what do my rules take"*. Nothing asked whether what the mailbox *has*
  still makes sense, so a label system rots invisibly while every command
  reports success. `audit` reports the folders no rule manages (split into ones
  holding mail, which want a rule, and empty scaffolding, which wants deleting),
  the pairs of labels that are one folder spelled two ways, and the mail no rule
  claims — with a coverage percentage, exiting non-zero while anything is
  outstanding. Run it every time.
- **Near-duplicate label detection.** `Receipts` and `Reciepts` both existed in
  a real mailbox for months with mail split across them. Case-folding never saw
  it, and edit distance alone scores a transposition at 2 and misses it — so the
  check is sorted-letter equality (catches any transposition exactly) plus edit
  distance ≤ 1 (catches a dropped character), both floored at 5 characters so it
  cannot cry wolf on short names.
- **`merge` — fold one folder into another**, in the only safe order: apply the
  target label, *then* remove the source, *then* delete the source folder.
  Reversed, every thread spends the gap between two API calls in neither folder.
- **`unlabel` as a receipt action**, so a merge is reversible. A merge that moves
  no mail is still recorded — the folder it deleted still has to come back.
- **`references/hygiene.md`** — what makes a label system maintainable rather
  than merely present, and why coverage is the number to watch.

### Changed

- **A run notices what is new.** The fetch now includes `has:nouserlabels`, and
  `propose` is no longer described as a first-run-only step. Uncategorised mail
  does not accumulate in the inbox — an archived thread no rule ever claimed sits
  outside it forever, invisible to every other command in the skill.
- **`audit` offers existing folders to nest a new sender under**, so a new
  employer's mail is proposed as `Recruiting/<name>` rather than as another
  top-level folder. That is the difference between a system that grows and one
  that sprawls.

### Fixed

- **`audit` no longer reports correctly-filed mail as unclaimed.** The first live
  run said 47 of 48 threads had no rule behind them, because it reused `plan` —
  which answers "is there work to do" and says no for a thread already sitting in
  the folder its rule files into, the most claimed thread in the mailbox. Those
  are two different questions, and `matches` now takes an `ignoreFiled` option to
  ask the second one.
- **`audit` says "count unknown" rather than guessing a folder holds mail.** A
  label list without `threadsTotal` cannot tell scaffolding from orphaned mail,
  and the two want opposite remedies.
- **The redactor no longer produces a corpus that describes two different
  mailboxes.** It now carries `threadsTotal` through (without it every frozen
  label audited as "count unknown", so the classification the golden exists to
  pin was never exercised), and redacts a rule set *in the same process* as the
  threads via `--rules-in`/`--rules-out` — separate invocations give the same
  sender different pseudonyms, so no rule matches anything and the audit reports
  zero coverage as though it were a real finding. Rule **ids and notes** are
  redacted too: both name organisations freely, and the audit golden prints rule
  ids in its own output.

## [0.3.0] - 2026-08-07

### Added

- **Sub-labels — splitting a folder that has grown into several things.**
  A new `subdivide` command reads the mail already in one folder, clusters it by
  sender domain, and returns the sub-labels that folder wants. A `Recruiting`
  folder holding four employers answers "is this job-hunt mail" and nothing more
  useful; nothing in the skill could previously ask whether a folder was still
  one category. It says so plainly when a folder *is* still one thing, because a
  sub-label holding everything its parent holds gives one pile two names.
- **A retroactive pass over mail already filed.** Every compiled query was
  hardcoded `in:inbox`, so new rules could only ever see new mail and the mail
  already in the folder — the mail you actually want sorted — was unreachable.
  `plan --scope 'label:Recruiting'` evaluates the same rules against a different
  slice of the mailbox. The pass is purely additive: nothing is unlabelled,
  nothing is trashed, and "would leave the inbox" is 0 because those threads
  already left it.
- **`plan --labels`**, resolving each thread's opaque `labelIds` into the names
  rules are written in. Without it the already-filed check can never fire on
  real fetched data, so every run re-proposes what the last one filed and a
  retroactive pass never converges.
- **A rule that can never fire is now reported** in the `rules` table, naming
  the earlier rule that takes everything it would.

### Changed

- **A nested destination applies its whole path.** Filing into
  `Recruiting/One Call` puts both `Recruiting` and `Recruiting/One Call` on the
  thread. Gmail's nesting is cosmetic — a thread carrying only the child does
  not appear under the parent — so without this, mail filed before a folder was
  split carries the parent and mail filed after it does not, and the parent view
  quietly stops being the whole category.
- **`labels` reconciles implied parents too**, and distinguishes a folder a rule
  names from one its nesting implies. Checking only the leaf would let the first
  `apply` create the parent implicitly, which is the one thing that command
  exists to prevent.
- **The receipt records the labels a run actually added**, not the rule's
  destination. Undoing a pass that added a sub-label to mail already sitting in
  the parent now gives back the parent instead of stripping it.
- **`plan` no longer claims it will archive mail that already left the inbox.**
  The per-rule "leaves inbox" column is now a per-thread count.

### Fixed

- **A rule filing into a folder standing in front of one filing into a
  sub-label of it is refused.** That pair does not fail cleanly, it *drifts*:
  fresh mail hits the parent rule first and never reaches the sub-rule, while
  mail already carrying the parent skips it and does. Which folder a thread ends
  up in depended on nothing but when it arrived, and nothing reported it.
- **`subdivide` never names a sub-label after the sender when that sender hosts
  mail for other organisations.** An applicant tracking system, a signing
  service and an invoicing platform send for whoever bought them, so the address
  names the vendor and the subject names the organisation. Naming a folder after
  the domain files every organisation into one — the same failure as filing a
  school district under its mail vendor, committed by the split meant to fix it.
  Those clusters come back unhoused with their distinct subjects attached, and a
  rule cannot be built for one without a `subjectContains`.
- **`apply` no longer reports threads as "staying in the inbox by rule" when
  they were never in the inbox.** A retroactive pass said that about all 13.
- **The baseline corpus no longer names an organisation the mailbox owner deals
  with.** `redact.mjs` pseudonymises sender domains and applicant-tracking
  subject lines; one employer domain was on the keep-list and should not have
  been. It also redacts nested label names per segment, so `Parent/Child`
  survives redaction as nesting rather than collapsing to one opaque name, and
  `--labels-from` resolves thread label ids through the same redaction as the
  label list — without it the two halves of a corpus describe different
  mailboxes while still looking complete.

## [0.2.0] - 2026-08-05

### Added

- **Sorting.** A `label` rule now files a thread into one of your own Gmail
  folders and takes it out of the inbox — the second half of what "triage"
  means. `label` was already a legal action in 0.1.0 and was a dead end:
  `authorise()` admitted only trash entries, so a sort rule could be written,
  validated and planned, and then nothing happened to it.

- **A move is `+label` and `−INBOX`, because Gmail has no folders.** A label
  rule performs both by default; `keepInInbox: true` tags in place instead. A
  label that leaves the mail exactly where it was has not sorted anything.

- **`gmailtriage labels`** — reconciles every folder the rules file into against
  the mailbox's real label list, prints the label id each destination resolves
  to (`label_thread` takes ids, never names), and **exits non-zero naming
  exactly what must be created**. Without it a run fails on thread 27 of 50,
  with 26 threads already moved and a receipt describing a mailbox that no
  longer exists.

- **The withheld table stopped being a dead end.** `propose` now returns a
  second table of sort candidates, drawn mostly from the senders it refuses to
  suggest trashing: a bank, a school district and a recruiter are the worst
  things in a mailbox to bin and the best things to file. `propose --labels`
  matches each cluster against the folders you already have, so a first run
  files into your vocabulary instead of inventing a parallel set beside it.

- **A cluster that ever delivered a login code is filed but never archived.**
  You can sort your receipts and still find, in your inbox, the code you are
  waiting for.

### Changed

- **The one rule now covers every move, not only trashing.** `authorise()` is
  scoped to an action: a plan that authorises filing a thread into "Receipts" is
  not a plan to trash it. Same thread id, same plan, catastrophically different
  outcome.
- **The receipt records what was done, not merely to what** — action, label, and
  whether `INBOX` was removed — and `undo` reverses each with the call that
  actually reverses it. Receipts written by 0.1.0 carry no action and are still
  read correctly as trash.
- A label rule's compiled query carries `-label:<destination>`, so a sort rule
  stops re-taking a thread already filed there. Without it a `keepInInbox` rule
  reports the same threads every run and "this rule suddenly took ten times its
  usual volume" stops meaning anything.
- The first-run walkthrough, `setup`, `rules` and `plan` all report the
  destination and whether a thread leaves the inbox.

### Fixed

- **A `label` rule naming `TRASH` or `SPAM` is refused.** It would have
  destroyed mail through the one action that exists so nothing is destroyed,
  past every trash guard in the skill — none of which look at a label rule.
  Gmail's other reserved labels and `CATEGORY_*` are refused too.
- **An unknown rule key is refused.** `keepInbox` for `keepInInbox` reads as
  "leave it in the inbox" and did the opposite, silently.
- **`list_labels` returns no `type` field**, so the system-label filter now
  matches by name. Found by running against a real mailbox: `INBOX`, `TRASH`,
  `SENT` and `SPAM` were being counted and matched as if they were the user's
  own folders.
- **`skill-invariants.json` named an `update_command` that did not exist.**
  Every baseline entry pointed at `evals/baseline/update.mjs`, which was never
  written — so the one-command refresh the house rules require had been a dead
  string since 0.1.0. It is now `bash evals/baseline/refresh.sh`, which exists
  and runs.
- The baseline redactor renamed folders in the label list but not in a thread's
  own `labels` array, leaking a real folder name into a public corpus. Both
  passes now share one pure function.

## [0.1.0] - 2026-08-04

### Added

- **First release.** Reads a Gmail inbox, categorises it, and moves junk to the
  trash under rules you wrote — never under the model's opinion.

- **The one rule is enforced by code, not by instruction.** `plan` enumerates
  exactly which threads each rule takes; `apply` refuses any thread the plan did
  not name, exits non-zero, and writes no receipt when it refuses. Every trashed
  thread is attributable to a rule by id.

- **Trash, never deletion.** The Gmail MCP exposes no permanent-delete
  operation, so the worst outcome is mail in your trash for 30 days. `undo`
  reads a receipt and restores exactly what a run took.

- **No default rule pack.** `propose` reads a slice of your real inbox and
  suggests rules drawn from your own senders, with the sample count and an
  example subject for each. It writes nothing and trashes nothing.

- **Rule validation refuses the inbox-emptiers** before a rule reaches a plan: a
  match naming no field, a `trash` constrained only by age, an unknown match
  field (a typo is a rule that silently never fires), a one-character match, a
  duplicate id, or a rule with no note.

- **`setup` — the only command safe to run cold.** It reports whether any rules
  exist and the single next step, and on a first run prints a short walkthrough:
  nothing is trashed until you accept a rule, and trash is recoverable. A first
  run should never open with an empty table.

- **An empty proposal explains itself.** `propose` now names which of three
  things produced no candidates — every sender below the threshold, every sender
  withheld by a guard, or no bulk mail at all — and lists the closest clusters
  with the threshold that would reach them.

### Found by the first run against a live inbox

- **It proposed trashing an active job pipeline.** Five threads from a careers
  address, three carrying multifactor codes. Nothing in the counts said "this is
  your career" — only the domain and the subjects did. Recruiting and
  applicant-tracking senders are now withheld, as is any cluster containing a
  login code, receipt, invoice or verification: a sender that ever delivers a
  credential cannot be bulk-trashed, however much marketing it also sends.

- **`\b` word boundaries do not work on domains.** `sanfordhealth.org`,
  `myworkday.com` and `candidates.workablemail.com` all slipped the guard
  because domains concatenate words. The patterns are substring matches now,
  which over-matches on purpose: a withheld sender costs one hand-written rule,
  a wrongly-proposed one can cost an interview.

- **Written-file paths moved to stderr.** On stdout they made every golden
  host-dependent, because the path carries the machine's tmpdir.

- **The bulk check now runs before the threshold check.** Reversed, a person with
  two threads landed in the "closest sender" list, so the new explanation invited
  the user to lower the threshold to catch their own realtor. `below` must only
  ever hold senders that would genuinely become candidates.

### Notes

The corpus in `evals/baseline/` is a real inbox fetch with identities replaced —
thread ids hashed, human senders and their subjects removed, role senders kept
because the guards match on them. It is a real run's *shape*, not a copy of a
mailbox, and `evals/baseline/redact.mjs` is how it was made.
