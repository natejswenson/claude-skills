---
name: gmailtriage
description: Sort and clean a Gmail inbox under rules the user wrote — filing mail into their own labels and out of the inbox, and moving junk to the trash. On a first run it walks the user through building that rule set from their own senders and their own existing folders, instead of shipping generic defaults. Use when the user says "clean my inbox", "gmailtriage", "triage my email", "sort my gmail", "file my email into folders", "auto-label my mail", "set up my email rules", "delete my junk mail", "unsubscribe and clean up", "why is my inbox full", or wants mail automatically filed, labelled or cleared out of Gmail without doing it by hand.
user_invocable: true
version: 0.7.0
---

# /gmailtriage — Sorts and cleans a Gmail inbox against rules you wrote — filing every thread into your own folders and trashing only what one of your own rules names, never what the model merely thinks is junk

You are running the **gmailtriage** skill.

**Announce at start:** "I'm using the gmailtriage skill — Sorts and cleans a Gmail inbox against rules you wrote — filing every thread into your own folders and trashing only what one of your own rules names, never what the model merely thinks is junk."

> Resolve the directory containing this `SKILL.md` once (`$SKILL_DIR`) and
> invoke the CLI as `node $SKILL_DIR/scripts/gmailtriage.js …` — the absolute
> script path works from any working directory, which is what makes it safe to
> keep every data file in the session scratchpad. A relative `scripts/…` path
> plus a `cd` is how a real run broke.

## The one rule

**A message is trashed only because a rule the user wrote matched it, and never because the model judged it junk — and the same holds for every other move, so a thread is labelled or archived only by a rule too. The model may propose a rule, but it may never act as one: every thread that moved can be named by the rule that moved it.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| report whether this mailbox has any rules yet, and the single next thing to do | `node scripts/gmailtriage.js setup` |
| normalize raw `search_threads`/`list_labels` tool output, written to files verbatim, into the snapshots every other command reads — dedupe, label-id union, category intersection, self-sent counting, and never a snippet on disk | `node scripts/gmailtriage.js ingest` |
| report whether the label system is still coherent — which folders no rule manages, which rules file into a folder that no longer exists, which are two spellings of one folder, and which mail no rule claims (self-sent mail excluded and counted) — and exit non-zero if any of it is outstanding | `node scripts/gmailtriage.js audit` |
| fold one folder into another, applying the target before removing the source, and record it so the fold can be undone | `node scripts/gmailtriage.js merge` |
| drop every sender an existing rule already claims, then cluster what is left into trash candidates and sort candidates, matching each sort cluster against the labels the mailbox already has | `node scripts/gmailtriage.js propose` |
| cluster a folder that already has mail in it by sender, match each cluster against the sub-labels that folder already has, and say when it is still one thing | `node scripts/gmailtriage.js subdivide` |
| validate, store and remove rules, compiling each to a Gmail query, refusing one that is malformed, matches everything, matches nothing, or files into a label Gmail owns, and backing the file up before every write | `node scripts/gmailtriage.js rules` |
| reconcile every folder the rules file into against the mailbox's real labels, and refuse to pass until each one exists | `node scripts/gmailtriage.js labels` |
| evaluate the stored rules against the inbox and enumerate exactly which threads each would take, where each goes, and which leave the inbox, without touching any of them | `node scripts/gmailtriage.js plan` |
| authorise exactly the threads the plan named, per action, refuse anything it did not, and write a receipt of every move | `node scripts/gmailtriage.js apply` |
| reverse every move listed in a previous run's receipt — untrash, unlabel, and put back in the inbox | `node scripts/gmailtriage.js undo` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide which proposed rules are actually safe to accept, and which cluster is a newsletter the user genuinely reads | a sender sending fifty near-identical bulk messages looks the same whether it is a retailer the user ignores or the school district they need; only the user knows which |
| **name a folder for a cluster that has no existing home** | a folder name is a decision about how the user already thinks — whether their word is "Shopping" or "Retail", whether the bank goes under "Finance" or its own name — and nothing in the mail says it. A script that guesses files a school district under its mail vendor |
| **name the organisation behind a sender that hosts mail for many of them** | an applicant tracking system, a signing service and an invoicing platform all send on behalf of whoever bought them, so the address names the vendor and the subject names the organisation. `no-reply@ashbyhq.com` is one employer in one thread and a different one in the next, and only reading the subject says which |
| decide whether a folder is several things or still one | four employers in `Recruiting` want splitting; four notices from one bank in `Statements` do not, and a sub-label holding everything its parent holds is worse than no sub-label. The counts look identical either way |
| **decide whether an unmanaged folder should be adopted or deleted** | a folder holding real mail with no rule behind it wants a rule; an empty one is scaffolding someone made once and wants deleting. The remedies are opposite and the thread count only tells you which is *likely* — a folder emptied last week still means something |
| decide which of two spellings is the right one | `audit` says two folders are one folder; it cannot say whether the user's word is `Receipts` or `Reciepts`, and folding mail into the misspelling is worse than leaving both |
| word each rule so a reader six months later can tell what it was meant to catch | a Gmail query is precise and unreadable, and a rule nobody can interpret is a rule nobody will dare to edit |
| judge when a plan looks wrong and should be questioned rather than applied | a rule that suddenly matches ten times its usual volume is either a sender gone rogue or a rule that drifted, and nothing in the count itself says which |

## The flow

### 0. Setup — always first, and the only thing safe to run cold

```bash
node $SKILL_DIR/scripts/gmailtriage.js setup
```

It says whether any rules exist and what the next step is. **On a first run it
prints a short walkthrough — read it out rather than diving into tables.** The
user should learn, before anything is fetched, that nothing moves until they
accept a rule, that sorting and trashing are two different things, and that
both are reversible.

If it reports a rule file that will not load, stop. Nothing runs against a rule
set that does not validate.

### 1. Fetch the sample, write it verbatim, and `ingest` — never build JSON by hand

**Load every Gmail tool the run can need in ONE ToolSearch, before fetching:**
`search_threads`, `list_labels`, `create_label`, `label_thread`,
`unlabel_thread`, `apply_sensitive_thread_label`, `untrash_thread`. Three
separate schema loads per run was a measured tax; one is enough.

The MCP is agent-side, so **you** call Gmail and the script decides. Four
searches, because `search_threads` does not return `CATEGORY_*` labels and
because the inbox is not where uncategorised mail accumulates:

```
search_threads  in:inbox                             pageSize 50   (default view)
search_threads  has:nouserlabels -in:trash -in:spam  pageSize 50   (default view)
search_threads  category:promotions -in:trash        pageSize 50   THREAD_VIEW_METADATA_ONLY
search_threads  category:updates -in:trash           pageSize 50   THREAD_VIEW_METADATA_ONLY
```

**The metadata-only view is for the two category fetches ONLY** — they exist
for their thread ids, and that view strips the snippets you do not need. The
first two fetches need subjects, so they use the default view; `ingest`
refuses a main fetch that arrives subject-less, because a metadata-only inbox
fetch produces ghost threads a later audit reports as unclaimed.

**The `has:nouserlabels` fetch is what makes a run notice anything new.** The
inbox is not where uncategorised mail accumulates — an archived thread that no
rule ever claimed sits outside the inbox forever, invisible to every other
command here. Skipping it is what makes a skill that only ever re-checks its own
existing work.

**Write each tool result to a scratchpad file VERBATIM** — `raw-inbox.json`,
`raw-nolabel.json`, `raw-promos.json`, `raw-updates.json`, and `list_labels`
to `raw-labels.json`. Byte-for-byte, exactly as the tool returned it: never
transcribe a tool response by hand, never trim it, never restructure it. Then
one command does all the reshaping:

```bash
node $SKILL_DIR/scripts/gmailtriage.js ingest \
  --inbox raw-inbox.json --nolabel raw-nolabel.json \
  --promos raw-promos.json --updates raw-updates.json \
  --labels raw-labels.json \
  --out-threads threads.json --out-labels labels.json
```

It dedupes across the fetches, unions label ids, derives `category` and the
`hasUnsubscribe` proxy from the id-intersection (documented in
`references/gmail.md`; do not present it as a fact), counts self-sent mail,
and writes only the seven snapshot fields — **a snippet never reaches disk**.
The label list is what makes a first run propose the user's *own* folders
rather than inventing a parallel set beside them; that is why `--labels` is
required.

**Every working file lives in the session scratchpad — never inside a git
repository.** The CLI refuses a data write into a working tree outright, and
the raw files you write with the Write tool are under the same rule: a
mailbox snapshot in a repo is one `git add` away from public. Run every
command with the `$SKILL_DIR`-absolute script path and scratchpad paths for
the files — never a relative `scripts/…` path, which breaks the moment the
working directory is not the skill's own checkout.

One narration line while fetching, then ingest's own tables. Never paste raw
thread JSON into the conversation — and the fetched results carry `snippet`
fields that have held live login codes, so: **Never re-print a snippet or a
code from a tool result**, not in a table, not in prose, not when asked what a
thread says. Name the thread by sender and subject instead.

### 1b. Audit — every run, before anything else

```bash
node $SKILL_DIR/scripts/gmailtriage.js audit --labels labels.json --threads threads.json
```

Every other command here asks *"what do my rules take"*. This is the only one
that asks *"is what I have still coherent"*, and a label system rots in ways the
first question can never see. **Run it every time**, and read out what it finds:

| It says | It means | The fix |
|---|---|---|
| `SAME AS X` | two spellings of one folder, with mail split across both | `merge`, then delete the empty one |
| `UNMANAGED — holds mail` | a folder that stays sorted only while the user sorts it by hand | write a rule — this is an *adopt* |
| `UNMANAGED — and empty` | scaffolding someone made once and never used | delete it; there is no mail in it to lose |
| `RULES THAT FILE INTO A FOLDER THAT DOES NOT EXIST` | the folder was deleted (or never created) but the rule survived | re-create the folder, or `rules --remove` / redirect the rule — **which is the user's call** |
| `MAIL NO RULE CLAIMS` | senders that arrived since the rules were written | a new rule, a new folder, or a trash rule |

**Non-zero means outstanding, not broken.** Report the findings and propose the
fixes; do not act on them silently. **Which spelling is right, and whether an
unmanaged folder should be adopted or deleted, are the user's calls** — a folder
emptied last week still means something, and folding mail into the misspelling
is worse than leaving both.

**When a cluster has no home, offer to nest it under something that already
exists.** `audit` prints the current top-level folders for exactly this. A new
employer's mail is `Recruiting/<name>`, not another top-level folder — that
distinction is the difference between a system that grows and one that sprawls.

### 2. Propose — the first run, or any run with mail that has no home

```bash
node $SKILL_DIR/scripts/gmailtriage.js propose --threads threads.json --labels labels.json --out candidates.json
```

It reads the rule file too (`--rules`, defaulting to the same path `audit` uses) and
**drops every sender an existing rule already claims** before it clusters anything.
Read the `Already claimed` table out loud rather than skipping it — a shrinking
candidate list with no stated cause reads as mail having gone missing. **Never
hand-write a rule for a sender listed there**: the user has already decided about
it, and a trash rule standing in front of their sort rule is how filed mail gets
binned.

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

### 2b. Subdivide — when a folder has grown into several things

A folder is worth splitting once it holds more than one organisation. `Recruiting`
holding four employers answers "is this job-hunt mail" and nothing more useful,
and no amount of scrolling makes it answer "what is happening with one of them".

```
search_threads  label:<Folder>   pageSize 50   → filed.json
```

```bash
node $SKILL_DIR/scripts/gmailtriage.js subdivide --threads filed.json --labels labels.json --parent "<Folder>"
```

**If it says the folder is still one thing, stop and say so.** A sub-label that
holds everything its parent holds is worse than no sub-label — the user now has
two names for one pile. Most folders are one thing; that is a result, not a
failure to find something.

**A vendor-hosted cluster can never be named from its sender, and the run must
not try.** An applicant tracking system, a signing service and an invoicing
platform send for whoever bought them, so the address names the vendor.
`subdivide` flags those and prints the distinct subjects, because that is where
the organisation's name actually is. Each one needs a `subjectContains` as well
as a name — a sender-only rule files every employer into one folder, which is
the same failure as filing a school district under its mail vendor, committed by
the thing that was supposed to fix it.

**Filing into a sub-label applies the parent too.** `Recruiting/Northwind` puts
both `Recruiting` and `Recruiting/Northwind` on the thread, so the parent view
stays the whole category and the sub-label narrows it. Say that when you show
the rules; a user who thinks their mail left `Recruiting` will go looking for it.

**Change the broad rule's destination — never add a sub-rule beside it.** A rule
filing into `Recruiting` standing in front of one filing into
`Recruiting/Contoso` does not fail, it *drifts*: fresh mail hits the
parent rule first, while mail already carrying `Recruiting` skips it and reaches
the sub-rule. `rules` refuses that pair outright, and the message says what to
change.

### 3. Accept rules

```bash
node $SKILL_DIR/scripts/gmailtriage.js rules --add candidates.json
```

It prints only the rules just added or changed — plus any shadow or lint
warning that involves them — and backs up the previous rule file before
writing. Show the compiled Gmail query for each, and **for every sort rule say
where it files to and whether the thread leaves the inbox.** A user who cannot
see the query cannot tell an over-broad rule from a precise one, and a user who
does not know a rule archives will be surprised the first time their mail is
not there. **Read the warnings out loud**: a bare-domain `from` also matches
lookalike domains, and a trash rule standing ahead of a sort rule for the same
sender is safe only by file order — both are the user's call to fix, not yours
to fix silently.

### 3b. Reconcile the folders — before anything moves

```bash
node $SKILL_DIR/scripts/gmailtriage.js labels --labels labels.json
```

When everything exists it says so in one summary row (`--verbose` has the full
destination table with label ids). Otherwise it exits non-zero and names
exactly the labels that do not exist yet — and the rules that file into them,
because a folder deleted on purpose wants the rule changed, not the folder
resurrected. To create: `create_label`, re-fetch `list_labels` verbatim over
`raw-labels.json`, then

```bash
node $SKILL_DIR/scripts/gmailtriage.js ingest --labels-only --labels raw-labels.json --out-labels labels.json
```

and re-run until it passes. **A mid-run mailbox change means one re-fetch —
never hand-edit a raw file.** The verbatim contract has no exceptions, and the
labels-only flag exists so refreshing one snapshot never asks for four thread
files back.

**On a run whose `plan` takes zero threads, this gate guards nothing — skip
it.** And since `audit` now proves every destination resolves, an audit that
came back clean already implies this passes. It stays mandatory before any
`apply`.
Do not skip to `plan` on a non-zero exit: a folder Gmail does not have is a
failed call on thread 27 of 50, with 26 threads already moved and a receipt
describing a mailbox that no longer exists.

### 4. Plan — always, every run

```bash
node $SKILL_DIR/scripts/gmailtriage.js plan --threads threads.json --labels labels.json --out plan.json
```

Report the per-rule counts, the per-folder counts, and a preview. **Say how many
threads would leave the inbox** — that is the number the user actually cares
about. **If a rule suddenly takes many times its usual volume, say so and stop**
— that is either a sender gone rogue or a rule that drifted, and nothing in the
count says which.

**Always pass `--labels`.** `search_threads` returns opaque label ids
(`Label_10`) and rules are written in words (`Recruiting`), so without the map
the planner cannot tell it has already filed a thread. Every run then re-proposes
everything the last one filed, and a second run never converges.

### 4b. The retroactive pass — applying new rules to mail already filed

New sub-label rules only ever see new mail. The mail already sitting in the
folder is what the user actually wants sorted, and it is out of the inbox, so
the default scope cannot reach it:

```bash
node $SKILL_DIR/scripts/gmailtriage.js plan --threads filed.json --labels labels.json \
  --scope 'label:<Folder>' --out plan.json
```

`--scope` replaces `in:inbox` in every compiled query — the same rules, a
different slice of the mailbox. Two things to say out loud about this run:
**"would leave the inbox" will be 0**, because these threads already left it;
and **nothing is unlabelled**, because the parent stays. It is purely additive,
which is why it is safe to run over mail the user has already organised by hand.

Then re-run the same command afterwards. **It must take zero threads the second
time.** If it does not, the labels did not resolve and the run has not converged.

### 5. Apply, then perform exactly what it authorised

```bash
node $SKILL_DIR/scripts/gmailtriage.js apply --plan plan.json --update-threads threads.json
```

**Do not pass `--receipt`.** The receipt defaults to
`~/.gmailtriage/receipts/<timestamp>.json` — the durable store `undo --last`
reads — and the path is printed. Every receipt a run steered into a session
scratchpad died with the session, and those runs are permanently un-undoable.
`--update-threads` replays the authorised moves onto the snapshot, so a
re-plan after a mid-run rule addition converges without re-fetching or
hand-editing anything.

It prints separate instruction blocks and writes one receipt. Perform them
exactly, and nothing else:

| Block | Call |
|---|---|
| TRASH these ids | `apply_sensitive_thread_label`, `labelOption: TRASH`, one per id |
| LABEL "X" onto these ids | `label_thread` with X, one per id |
| REMOVE the INBOX label from these ids | `unlabel_thread` removing `INBOX` — this is the "move" |

The MCP has no batch call, but you do: **issue each block's calls in parallel,
in one message** — a real run spent thirty sequential round-trips on
seventeen threads. Parallelise within a block, never across blocks: every
LABEL call lands before the first REMOVE-INBOX call, so a thread is never out
of the inbox and not yet in its folder.

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

One table — rule, action, destination, threads — then the receipt path (under
`~/.gmailtriage/receipts/`, where it outlives this session). Say plainly that
**nothing was deleted**: trash is recoverable for 30 days, and a filed thread
is one label away from where it was. Offer `undo --last`; do not bury it.

## Commands

| Command | Returns |
|---|---|
| `gmailtriage setup` | state, rule counts by action, rule file — plus a first-run walkthrough when nothing is configured. The full rule table lives behind `rules`, so a run does not open with fifty rows nobody asked for |
| `gmailtriage ingest` | take the raw output of the four `search_threads` fetches and `list_labels`, written to files verbatim, and produce the thread and label snapshots every other command reads — deduping threads across fetches, unioning label ids, deriving the category and bulk-mail markers, counting self-sent mail, refusing a metadata-only fetch by name, and never writing a snippet to disk. Ends hand-transcribed JSON, which was the slowest and least reliable step of every real run |
| `gmailtriage propose` | read a slice of the user's real inbox, the labels they already have and the rules they have already written, drop every sender an existing rule claims, and cluster only what is left — returning two tables, bulk mail worth trashing and mail worth keeping but filing, each matched to an existing folder or flagged as needing a name, plus the senders it excluded and which rule claims each. So a first run starts from the user's own mail and own folders rather than generic defaults, and a later run can never re-propose or contradict a rule they already wrote. Proposes only; writes no rule and moves nothing. |
| `gmailtriage audit` | read the mailbox's real label list, the rule set and a sample of mail, and report whether the label system is still coherent — every folder no rule manages (split into ones holding mail and empty scaffolding), every rule that files into a folder that no longer exists, every pair of labels that are one folder spelled two ways, and every thread no rule claims, each matched to a folder that already exists or flagged as needing a name. Returns a coverage percentage and exits non-zero while anything is outstanding, so a system that is quietly rotting cannot read as clean. Reads only; moves nothing. |
| `gmailtriage merge` | fold one folder into another, returning the operations in the only safe order — apply the target label first, remove the source second, delete the source folder last — plus a receipt so the fold can be reversed. A merge that moves no mail is still recorded, because the folder it deleted still has to come back. |
| `gmailtriage subdivide` | read the mail already in one folder, cluster it by sender domain, and return the sub-labels that folder wants — each matched to a sub-label it already has or flagged as needing a name, and each sender that hosts mail for many organisations flagged as needing a subject matcher too, with its distinct subjects printed. Says plainly when a folder is still one thing and should be left alone. Proposes only; writes no rule and moves nothing. |
| `gmailtriage rules` | read, validate, write and remove rules — `--add` prints only the rules just added with any warning that involves them, `--remove <id[,id]>` deletes exactly the named rules and refuses an id that does not exist, and every write lands a timestamped backup of the previous file first. The table shows rule id, action, destination, whether the thread leaves the inbox, and the compiled Gmail query, so an over-broad rule is visible before it ever runs. |
| `gmailtriage labels` | reconcile every folder the rules file into against the mailbox's real label list, returning a table of destination, whether it exists, and which rules use it — and exit non-zero naming exactly what must be created, so a run never fails halfway with some mail moved and some not. |
| `gmailtriage plan` | evaluate every rule against the inbox and return the exact set of threads each rule would take, where each one goes, and how many leave the inbox, as tables of rule, destination and count plus any thread matched by more than one rule. Reads only; moves nothing. |
| `gmailtriage apply` | authorise exactly the threads a named plan listed, per action, refusing any thread the plan did not name for that action, and write a receipt recording every move so the run can be undone. Returns the threads to trash, the threads to label with which label, and the threads to take out of the inbox, as three separate blocks. |
| `gmailtriage undo` | read a receipt from a previous apply — or find the newest one itself with `--last`, since receipts live in `~/.gmailtriage/receipts/` — and reverse every move it made: untrash what was trashed, remove the label from what was filed, and put back in the inbox what was archived, returning a table of thread id, what happened to it, and the rule that did it, so a run the user regrets is reversible without hunting through Gmail by hand. |

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
- **Never leave a folder unmanaged without saying so.** A folder no rule files
  into stays sorted exactly as long as the user keeps sorting it by hand, and
  nothing in Gmail ever mentions it. Report it every run; a skill that maintains
  half a mailbox and never says which half is worse than one that maintains none.
- **Never delete a label with mail in it, and never delete one on your own.**
  Deleting an empty folder loses nothing. Deleting a folder holding mail loses
  the only record of why that mail was kept together — and `merge` exists so
  that never has to happen.
- **Never fold two folders together without asking which spelling is right.**
  `audit` can prove two names are one folder; nothing on disk says whether the
  user's word is "Receipts" or "Reciepts", and folding into the wrong one is a
  folder they will never think to look in.
- **Never name a sub-label after the sender when the sender hosts mail for
  other organisations.** An applicant tracking system, a signing service, an
  invoicing platform: the address names the vendor and the subject names the
  organisation. `Recruiting/Ashbyhq` files every employer into one folder — the
  same failure as filing a school district under its mail vendor, committed by
  the split that was supposed to fix it. Those rules carry a `subjectContains`,
  and the name comes from reading the subject.
- **Never split a folder that is still one thing.** Four employers in
  `Recruiting` want sub-labels; four notices from one bank in `Statements` do
  not. A sub-label holding everything its parent holds has not organised
  anything — it has given one pile two names.
- **Never let a broad rule stand in front of a rule filing into a sub-label of
  its own destination.** That pair does not fail, it drifts: fresh mail takes
  the parent and mail already filed takes the child, and which one a thread gets
  depends only on when it arrived. Change the broad rule's destination.
- **Never say a thread left its parent folder.** Filing into `Recruiting/One
  Call` applies `Recruiting` as well. The parent view is still the whole
  category; the sub-label narrows it. A user who thinks their mail moved out
  will go looking for it.
- **Never propose a rule for a sender an existing rule already claims.** `propose`
  now excludes them, but the rule is on you as well: if a candidate names a sender
  that appears in the `Already claimed` table, or that you can see in the rule list,
  do not write a rule for it by hand. The user has already decided about that sender,
  and the dangerous case is not the duplicate — it is a *trash* rule standing in
  front of their *sort* rule, which bins mail they deliberately kept.
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
- **Never re-print a snippet or a code from a tool result.** `search_threads`
  returns message snippets beside the subjects, and on a real mailbox those
  snippets have carried live verification codes — twice. `ingest` structurally
  never writes one to disk; this line is the same guarantee for the
  conversation. Name a thread by its sender and subject, never by what the
  message says.
- **Never write mailbox data where git can see it, and never transcribe a tool
  response by hand.** Raw fetches, snapshots, plans and candidate files live in
  the session scratchpad; the CLI refuses a data write inside a git working
  tree, and the files you write with the Write tool are under the same rule — a
  real run once put its thread snapshot in a checkout, and deleting it cost the
  run its receipt. Verbatim files plus `ingest` is the whole fetch contract.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/gmailtriage.js` | the CLI: `setup`, `ingest`, `audit`, `merge`, `propose`, `subdivide`, `rules`, `labels`, `plan`, `apply`, `undo` |
| `references/rules.md` | the rule format, what each field means, and the checks a rule must survive before it can move anything |
| `references/sorting.md` | what a "folder" actually is in Gmail, how a move is performed and reversed, and why the destination is the user's word and not the skill's |
| `references/safety.md` | why nothing here is permanent deletion, what the receipt records, and how an unwanted run is undone |
| `references/gmail.md` | the Gmail tool surface this skill is built on — the query syntax, the page limits, and the operations that do not exist |
| `references/hygiene.md` | what makes a label system maintainable rather than merely present — every folder having a rule, no folder spelled two ways, and why coverage is the number to watch |
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
