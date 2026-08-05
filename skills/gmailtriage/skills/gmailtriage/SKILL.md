---
name: gmailtriage
description: Sort and clean a Gmail inbox under rules the user wrote — filing mail into their own labels and out of the inbox, and moving junk to the trash. On a first run it walks the user through building that rule set from their own senders and their own existing folders, instead of shipping generic defaults. Use when the user says "clean my inbox", "gmailtriage", "triage my email", "sort my gmail", "file my email into folders", "auto-label my mail", "set up my email rules", "delete my junk mail", "unsubscribe and clean up", "why is my inbox full", or wants mail automatically filed, labelled or cleared out of Gmail without doing it by hand.
user_invocable: true
version: 0.2.0
---

# /gmailtriage — Sorts and cleans a Gmail inbox against rules you wrote — filing every thread into your own folders and trashing only what one of your own rules names, never what the model merely thinks is junk

You are running the **gmailtriage** skill.

**Announce at start:** "I'm using the gmailtriage skill — Sorts and cleans a Gmail inbox against rules you wrote — filing every thread into your own folders and trashing only what one of your own rules names, never what the model merely thinks is junk."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**A message is trashed only because a rule the user wrote matched it, and never because the model judged it junk — and the same holds for every other move, so a thread is labelled or archived only by a rule too. The model may propose a rule, but it may never act as one: every thread that moved can be named by the rule that moved it.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| report whether this mailbox has any rules yet, and the single next thing to do | `node scripts/gmailtriage.js setup` |
| cluster a real inbox sample into trash candidates and sort candidates, matching each sort cluster against the labels the mailbox already has | `node scripts/gmailtriage.js propose` |
| validate and store rules, compiling each to a Gmail query and refusing one that is malformed, matches everything, matches nothing, or files into a label Gmail owns | `node scripts/gmailtriage.js rules` |
| reconcile every folder the rules file into against the mailbox's real labels, and refuse to pass until each one exists | `node scripts/gmailtriage.js labels` |
| evaluate the stored rules against the inbox and enumerate exactly which threads each would take, where each goes, and which leave the inbox, without touching any of them | `node scripts/gmailtriage.js plan` |
| authorise exactly the threads the plan named, per action, refuse anything it did not, and write a receipt of every move | `node scripts/gmailtriage.js apply` |
| reverse every move listed in a previous run's receipt — untrash, unlabel, and put back in the inbox | `node scripts/gmailtriage.js undo` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide which proposed rules are actually safe to accept, and which cluster is a newsletter the user genuinely reads | a sender sending fifty near-identical bulk messages looks the same whether it is a retailer the user ignores or the school district they need; only the user knows which |
| **name a folder for a cluster that has no existing home** | a folder name is a decision about how the user already thinks — whether their word is "Shopping" or "Retail", whether the bank goes under "Finance" or its own name — and nothing in the mail says it. A script that guesses files a school district under its mail vendor |
| word each rule so a reader six months later can tell what it was meant to catch | a Gmail query is precise and unreadable, and a rule nobody can interpret is a rule nobody will dare to edit |
| judge when a plan looks wrong and should be questioned rather than applied | a rule that suddenly matches ten times its usual volume is either a sender gone rogue or a rule that drifted, and nothing in the count itself says which |

## The flow

### 0. Setup — always first, and the only thing safe to run cold

```bash
node scripts/gmailtriage.js setup
```

It says whether any rules exist and what the next step is. **On a first run it
prints a short walkthrough — read it out rather than diving into tables.** The
user should learn, before anything is fetched, that nothing moves until they
accept a rule, that sorting and trashing are two different things, and that
both are reversible.

If it reports a rule file that will not load, stop. Nothing runs against a rule
set that does not validate.

### 1. Fetch the sample and the label list — the agent does this, not the script

The MCP is agent-side, so **you** call Gmail and the script decides. Three
searches, because `search_threads` does not return `CATEGORY_*` labels:

```
search_threads  in:inbox                      pageSize 50
search_threads  in:inbox category:promotions  (ids only)
search_threads  in:inbox category:updates     (ids only)
```

Write `threads.json` as an array of
`{id, from, subject, date, labelIds, category, hasUnsubscribe}` — `category`
from the intersection, `hasUnsubscribe` true for promotions and updates. That
proxy is documented in `references/gmail.md`; do not present it as a fact.

**Then `list_labels`, written to `labels.json`.** This is what makes a first run
propose the user's *own* folders rather than inventing a parallel set beside
them. Skipping it is not a smaller run — it is a run where every sort candidate
comes back unhoused.

One narration line while fetching, then a table. Never paste raw thread JSON
into the conversation.

### 2. Propose — only on a first run, and it moves nothing

```bash
node scripts/gmailtriage.js propose --threads threads.json --labels labels.json --out candidates.json
```

It prints **two** candidate tables, and they are not the same question:

- **TRASH** — bulk mail a rule would bin.
- **SORT** — mail worth keeping, filed into one of the user's folders and taken
  out of the inbox. Most of these come from the *withheld* list: a bank, a
  school district, a recruiter is a terrible thing to trash and the best thing
  in the mailbox to file.

**If either table is empty, read out the reason it gives.** An empty table is a
result, and `propose` says which of three things produced it. Never present an
empty table on its own; that reads as a broken skill.

**Naming an unhoused folder is your judgment, and you must ask.** A sort
candidate with no matching label comes back as `— needs a name —`. Propose a
name in the user's existing vocabulary — look at the folders they already have —
say why, and let them change it. Never file into a name they have not seen.

**Never argue with a withheld sender.** If the user wants it, they write the
rule; the guard constrains what the skill proposes, never what they may decide.

### 3. Accept rules

```bash
node scripts/gmailtriage.js rules --add candidates.json
```

Show the compiled Gmail query for each, and **for every sort rule say where it
files to and whether the thread leaves the inbox.** A user who cannot see the
query cannot tell an over-broad rule from a precise one, and a user who does not
know a rule archives will be surprised the first time their mail is not there.

### 3b. Reconcile the folders — before anything moves

```bash
node scripts/gmailtriage.js labels --labels labels.json
```

It exits non-zero and names exactly the labels that do not exist yet. **Create
those with `create_label`, re-fetch `list_labels`, and re-run until it passes.**
Do not skip to `plan` on a non-zero exit: a folder Gmail does not have is a
failed call on thread 27 of 50, with 26 threads already moved and a receipt
describing a mailbox that no longer exists.

### 4. Plan — always, every run

```bash
node scripts/gmailtriage.js plan --threads threads.json --out plan.json
```

Report the per-rule counts, the per-folder counts, and a preview. **Say how many
threads would leave the inbox** — that is the number the user actually cares
about. **If a rule suddenly takes many times its usual volume, say so and stop**
— that is either a sender gone rogue or a rule that drifted, and nothing in the
count says which.

### 5. Apply, then perform exactly what it authorised

```bash
node scripts/gmailtriage.js apply --plan plan.json --receipt <receipt.json>
```

It prints separate instruction blocks and writes one receipt. Perform them
exactly, and nothing else:

| Block | Call |
|---|---|
| TRASH these ids | `apply_sensitive_thread_label`, `labelOption: TRASH`, one per id |
| LABEL "X" onto these ids | `label_thread` with X, one per id |
| REMOVE the INBOX label from these ids | `unlabel_thread` removing `INBOX` — this is the "move" |

**A thread you touch that the plan did not name has no rule behind it**, which is
the one thing this skill exists to refuse. And the blocks are not
interchangeable: a thread authorised to be filed is not authorised to be
trashed. `apply` enforces that per action, so pass the ids back as
`--trash <ids.json>` and `--sort <ids.json>` if you want the check after the
fact — it exits non-zero naming any id the plan never authorised for that
action, and writes no receipt.

Threads listed under a `keepInInbox` rule are labelled and **stay in the inbox**.
`apply` says how many. Do not archive those.

### 6. Report, and say the undo

One table — rule, action, destination, threads — then the receipt path. Say
plainly that **nothing was deleted**: trash is recoverable for 30 days, and a
filed thread is one label away from where it was. Offer `undo`; do not bury it.

## Commands

| Command | Returns |
|---|---|
| `gmailtriage setup` | state, rule count, rule file — plus a first-run walkthrough when nothing is configured |
| `gmailtriage propose` | read a slice of the user's real inbox and the labels they already have, cluster the mail by sender, and return two tables — bulk mail worth trashing, and mail worth keeping but filing, each matched to an existing folder or flagged as needing a name. So a first run starts from the user's own mail and own folders rather than from generic defaults. Proposes only; writes no rule and moves nothing. |
| `gmailtriage rules` | read, validate and write the rule file, returning a table of rule id, action, destination, whether the thread leaves the inbox, and the Gmail query it compiles to — so a rule that would silently match everything, match nothing, or file into a label Gmail owns is visible before it ever runs. |
| `gmailtriage labels` | reconcile every folder the rules file into against the mailbox's real label list, returning a table of destination, whether it exists, and which rules use it — and exit non-zero naming exactly what must be created, so a run never fails halfway with some mail moved and some not. |
| `gmailtriage plan` | evaluate every rule against the inbox and return the exact set of threads each rule would take, where each one goes, and how many leave the inbox, as tables of rule, destination and count plus any thread matched by more than one rule. Reads only; moves nothing. |
| `gmailtriage apply` | authorise exactly the threads a named plan listed, per action, refusing any thread the plan did not name for that action, and write a receipt recording every move so the run can be undone. Returns the threads to trash, the threads to label with which label, and the threads to take out of the inbox, as three separate blocks. |
| `gmailtriage undo` | read a receipt from a previous apply and reverse every move it made — untrash what was trashed, remove the label from what was filed, and put back in the inbox what was archived — returning a table of thread id, what happened to it, and the rule that did it, so a run the user regrets is reversible without hunting through Gmail by hand. |

## Rules that are not negotiable

- **A message is trashed only because a rule the user wrote matched it, and never because the model judged it junk — and the same holds for every other move, so a thread is labelled or archived only by a rule too. The model may propose a rule, but it may never act as one: every thread that moved can be named by the rule that moved it.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never trash a thread the plan did not name.** The plan is the authorisation;
  a thread outside it has no rule behind it.
- **Never move a thread the plan did not name, and never under an action it did
  not authorise.** A plan to file a thread into "Receipts" is not a plan to
  trash it, and a plan to trash one is not permission to archive it. Same thread
  id, same plan, entirely different outcome.
- **Never trash a sender the user asked to sort.** Filing and binning are
  opposite intents, and the sort table exists because the withheld senders are
  the ones worth keeping.
- **Never invent a folder name silently.** An unhoused cluster is shown to the
  user and named with them. Filing mail into a word they have never used is how
  they stop being able to find it.
- **Never propose a *trash* rule for a withheld sender.** Financial, medical,
  governmental, educational and recruiting senders, and any cluster carrying a
  login code, receipt or verification, stay withheld from trashing. They may
  still be proposed for *sorting* — that is the point. The user may write any
  rule themselves; the guard is on what the skill suggests.
- **Never archive a cluster that delivers codes.** A sender that ever sent a
  login code, receipt or verification is tagged in place and left in the inbox,
  so the code the user is waiting for is still where they will look for it.
- **Never call trash "deleted", and never call archiving "deleted" either.**
  Trash is recoverable for 30 days; an archived thread was never destroyed at
  all. Saying so is the reason this is safe to run.
- **Never skip the plan.** Even on a run where nothing changed, the plan is what
  makes every move attributable.
- **Never apply against an unreconciled folder.** If `labels` exits non-zero,
  create what it names and re-run it. A missing label fails mid-run, and a
  half-applied run is the one state the receipt cannot describe.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/gmailtriage.js` | the CLI: `setup`, `propose`, `rules`, `labels`, `plan`, `apply`, `undo` |
| `references/rules.md` | the rule format, what each field means, and the checks a rule must survive before it can move anything |
| `references/sorting.md` | what a "folder" actually is in Gmail, how a move is performed and reversed, and why the destination is the user's word and not the skill's |
| `references/safety.md` | why nothing here is permanent deletion, what the receipt records, and how an unwanted run is undone |
| `references/gmail.md` | the Gmail tool surface this skill is built on — the query syntax, the page limits, and the operations that do not exist |
| `references/proposing.md` | how a first run turns a real inbox into candidate rules, and the clusters it deliberately never proposes |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.9.0 sha256:ce9c1c6b30d6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Never print file contents into the conversation.** Not a fetched page, not a
  source file, not a script's own source. Scripts hand each other *paths*; when
  you need a file's text in context, use the `Read` tool rather than `cat`,
  `sed`, `head`, or a `--show` flag. Anything the user already has open
  somewhere is a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, `Read` the
  rendered image so the user sees it, instead of writing a paragraph about it.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->
