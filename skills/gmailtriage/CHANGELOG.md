# Changelog

All notable changes to the **gmailtriage** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
