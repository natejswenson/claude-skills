# Changelog

All notable changes to the **gmailtriage** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-09-14

### Fixed

- **Codex Gmail searches now feed Gmailtriage's thread-based workflow without hand-built snapshots.** The skill recognizes Codex's message and label response envelopes, groups messages by thread, and preserves the existing snippet-free snapshot guarantee.

## [0.8.0] - 2026-09-14

### Added

- **Gmail Triage can ingest paginated mailbox samples and report whether retrieval was complete.**
- **Rules can match exact sender addresses and domains.**
- **Rules can use categories produced during ingestion.**
- **Gmail operations are confirmed before receipts and snapshots record them.**
- **Gmail Triage now works consistently in Claude Code and Codex.** Both hosts use the same plugin release and compatibility checks.
- **Terminal output follows the shared presentation contract.** Interactive runs now use the repository's standard terminal styling.

### Fixed

- **Retroactive planning stays within the selected mailbox scope and only adds safe filing work.** Existing plans are preserved while newly discovered eligible threads can be incorporated.

## [0.7.0] - 2026-08-13

### Fixed

- **`audit` now asks the reverse coherence question: does every folder the
  rules file into still exist?** Audit reconciles
  rule destinations against the real label list (the same
  `reconcileDestinations` the `labels` gate uses), reports each dangling
  destination with the rules that use it, names both remedies without choosing
  one (re-create the folder, or remove/redirect the rule — the user's call),
  and refuses to call the system clean over it. Reported as its own section,
  not a summary column, so the frozen summary shape is unchanged.
- **An all-self-sent sample now says so.** Both proposal reasons use
  `all-sent-only` rather than recommending a wider fetch.

### Added

- **`rules --remove <id[,id]>`** — before this, the only way to drop a rule was
  hand-editing the validated store, which is the exact thing the store exists
  to prevent. Removal names its rules in a table, lands the same timestamped
  backup every write now gets, revalidates the remainder before writing,
  refuses an id that does not exist (rather than silently skipping it), and
  refuses to combine with `--add` — two intents, two commands.
- **`ingest --labels-only`** refreshes label metadata without requiring thread
  fetches. Re-fetch changed mailbox metadata; never hand-edit raw tool results.

- **`labels` names the other remedy.** Its failure text presumed creation;
  it now also lists the rule ids to `--remove` or redirect when the folder
  went away on purpose.

### Changed

- SKILL.md: on a run whose plan takes zero threads, the `labels` gate guards
  nothing and may be skipped — and an audit that came back clean already
  implies it would pass, since audit now checks destinations. It stays
  mandatory before any `apply`.

## [0.6.0] - 2026-08-13

Metadata ingestion, durable receipts and bounded output improvements.

### Added

- **`ingest` — raw MCP output in, snapshots out.** Normalize verbatim fetches,
  deduplicate threads, union label IDs, derive category evidence and count
  self-sent mail. Only allowlisted snapshot fields are written; snippets are
  excluded. Metadata-only main fetches are refused by name; `--force` overrides.

- **`apply --update-threads`** replays authorized moves onto the working
  snapshot so re-planning can converge without manual metadata edits. Added
  label names go into `labelIds` to preserve resolution of existing IDs.

- **`undo --last`** selects the newest durable receipt by its `at` timestamp,
  independently of filename spelling or modification time.

- **`rules --add` backs up the rule file** beside itself before every write.
  Nothing made the rule file itself reversible before, and it holds the only
  copy of every rule note.
- **Rule lints — warned, never refused.** Warn about bare-domain substring
  matching and trash rules that precede overlapping sort rules.

- **`labels --verbose`** keeps the full destination table; the default now
  prints only what needs creating.

### Changed

- **Self-sent, never-filed mail is excluded from unclaimed counts.**
  SENT-only threads without user labels are reported separately by `audit` and
  `propose`; synthetic cases verify that clean mailbox states remain reachable.

- **Receipts default to `~/.gmailtriage/receipts/<timestamp>.json`** so undo
  evidence survives session scratch cleanup.

- **Bounded output.** `setup` prints a summary; `rules --add` prints added
  rules and warnings; `labels` defaults to missing destinations. Verbose modes
  retain complete tables.

- **SKILL.md uses the verbatim-file contract.** Load Gmail tools together, use
  metadata-only views for category membership, execute authorized operation
  blocks in order and resolve CLI paths independently of the working directory.

### Security

- **The CLI refuses to write mailbox data inside a git repository**
  unless `--allow-repo` is explicit. The private state directory is exempt so
  a home directory managed by dotfiles can still store rules and receipts.

- `~/.gmailtriage` directories are created `0700` and files written `0600`.
- **Snippet handling is now a named contract**: never re-printed in
  conversation (new non-negotiable, pinned in `skill-invariants.json`), never
  written to disk (trap test greps the frozen ingest output for the planted
  code the raw fixtures carry), and documented in `references/gmail.md` —
  along with `resultCountEstimate` being a number no run may ever repeat as a
  fact.

## [0.5.0] - 2026-08-08

### Fixed

- **`propose` no longer proposes rules for mail your rules already cover — and
  the dangerous case was not the duplicate.** It clustered senders with no
  knowledge of the rule set at all: `propose(threads, { minCount, labels })`
  took no rules and read no rule file. A sender already claimed by a sorting
  rule could therefore be proposed for trashing. `propose` now reads
  the rule file (`--rules`, defaulting to the same path `audit` uses) and drops
  every claimed sender before clustering.

  This is the same defect class as the one `audit` had in 0.4.0, with the same
  remedy sitting three functions away: `matches(..., { ignoreFiled: true })`,
  because a thread already sitting in the folder its rule files into is the
  *most* claimed thread in the mailbox, not an unclaimed one.

  Claimed is judged at **sender** granularity, not per thread. A rule that
  matches only some of a sender's mail still proves the user has decided about
  that sender, and the leftover threads are exactly what would otherwise cluster
  into a trash rule standing in front of their sort rule.

### Added

- **Exclusions are reported, never silently dropped.** `propose` prints an
  `Already claimed` table naming each excluded sender, its thread count and the
  rule that claims it, plus an `Already claimed` column in the summary. A
  shrinking candidate table with no stated cause reads as mail having gone
  missing.
- **A fully-covered sample now says so.** Previously a sample where every sender
  was already claimed fell through to *"no bulk mail in the sample at all. Widen
  the fetch"* — sending the user to re-fetch a mailbox that was working exactly
  as intended. Both `reason` and `sortReason` gained an `all-claimed` kind that
  outranks it.
- **A second frozen baseline run, `propose-covered.txt`**, over the same corpus
  as `propose.txt` but with the corpus rule set. The pair is what proves the
  filter fires on coverage rather than on the fixture: one run proposes
  everything, the other proposes nothing and names why.

### Changed

- **The frozen first-run `propose` now passes `--rules evals/baseline/rules-none.json`
  explicitly.** `propose` defaults to `~/.gmailtriage/rules.json`, which is right
  for a user and wrong for a hermetic baseline — without this the frozen run
  would read the personal rule file of whoever ran `refresh.sh`. A first run
  genuinely has no rules; the fixture says so out loud instead of relying on a
  file being absent.

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
- **Near-duplicate label detection.** The synthetic pair `Receipts` and `Reciepts` tests a transposition. Case-folding
  does not detect it, and *plain* edit distance scores a transposition at 2 and misses it — so
  the check is **Damerau**-Levenshtein distance ≤ 1, which treats an adjacent
  swap as one edit, floored at 5 characters so it cannot cry wolf on short names.
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

### Security

- **The baseline corpus uses deterministic synthetic fixtures.** Generate fixtures
  with `evals/baseline/make-corpus.mjs`; use reserved sender domains and review
  generator changes. Never import mailbox exports into the fixture set.
- **`redact.mjs` is deleted.** Its only purpose was to make real mail
  committable, and keeping it invites exactly that.

### Fixed

- **`audit` no longer reports correctly-filed mail as unclaimed.** It reused `plan` —
  which answers "is there work to do" and says no for a thread already sitting in
  the folder its rule files into, the most claimed thread in the mailbox. Those
  are two different questions, and `matches` now takes an `ignoreFiled` option to
  ask the second one.
- **`audit` says "count unknown" rather than guessing a folder holds mail.** A
  label list without `threadsTotal` cannot tell scaffolding from orphaned mail,
  and the two want opposite remedies.
- **Fixture coverage includes label counts, nested labels and coherent rule matching.**

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
  `Recruiting/Globex` puts both `Recruiting` and `Recruiting/Globex` on the
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
  they were never in the inbox.** Inbox claims now follow the fetched metadata.
- **Synthetic fixture generation keeps nested labels and rule matching coherent.**

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
  exactly what must be created** before any operation is attempted.

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
  matches by name. Reserved examples include: `INBOX`, `TRASH`,
  `SENT` and `SPAM` were being counted and matched as if they were the user's
  own folders.
- **`skill-invariants.json` named an `update_command` that did not exist.**
  Every baseline entry pointed at `evals/baseline/update.mjs`, which was never
  written — so the one-command refresh the house rules require had been a dead
  string since 0.1.0. It is now `bash evals/baseline/refresh.sh`, which exists
  and runs.
- Synthetic fixture generation keeps label lists and thread label names coherent.

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

### Guard regression coverage

- **Recruiting and credential guards.** Protect applicant-tracking senders
  and clusters containing login codes, receipts, invoices or verification mail,
  independently of bulk-mail counts.

- **Domain guard matching uses substrings.** Domain labels concatenate
  product and category words; word boundaries can miss those markers.

- **Written-file paths moved to stderr.** On stdout they made every golden
  host-dependent, because the path carries the machine's tmpdir.

- **The bulk check precedes the threshold check.** A sender without bulk
  evidence must not enter a below-threshold list that encourages broader action.

### Notes

The offline regression corpus is synthetic and generated by
`evals/baseline/make-corpus.mjs`; mailbox exports are never fixture inputs.
