---
name: gmailtriage
description: Read a Gmail inbox, categorise the mail, and move junk to the trash under rules the user wrote. On a first run it proposes a starter rule set drawn from the user's own senders instead of shipping generic defaults. Use when the user says "clean my inbox", "gmailtriage", "triage my email", "delete my junk mail", "sort my gmail", "unsubscribe and clean up", "why is my inbox full", "set up my email rules", or wants bulk, promotional or bogus mail cleared out of Gmail without hand-deleting it.
user_invocable: true
version: 0.1.0
---

# /gmailtriage — Triages a Gmail inbox against rules you wrote — categorising every thread and trashing only what one of your own rules names, never what the model merely thinks is junk

You are running the **gmailtriage** skill.

**Announce at start:** "I'm using the gmailtriage skill — Triages a Gmail inbox against rules you wrote — categorising every thread and trashing only what one of your own rules names, never what the model merely thinks is junk."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**A message is trashed only because a rule the user wrote matched it, and never because the model judged it junk — the model may propose a rule, but it may never act as one, so every trashed thread can be named by the rule that took it.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| cluster a real inbox sample into candidate rules by sender, mailing list and bulk-mail markers, with counts and a sample subject for each | `node scripts/gmailtriage.js propose` |
| validate and store rules, compiling each to a Gmail query and refusing one that is malformed, matches everything, or matches nothing | `node scripts/gmailtriage.js rules` |
| evaluate the stored rules against the inbox and enumerate exactly which threads each would take, without touching any of them | `node scripts/gmailtriage.js plan` |
| trash exactly the threads the plan named, refuse anything it did not, and write a receipt of every thread id moved | `node scripts/gmailtriage.js apply` |
| restore every thread listed in a previous run's receipt | `node scripts/gmailtriage.js undo` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide which proposed rules are actually safe to accept, and which cluster is a newsletter the user genuinely reads | a sender sending fifty near-identical bulk messages looks the same whether it is a retailer the user ignores or the school district they need; only the user knows which |
| word each rule so a reader six months later can tell what it was meant to catch | a Gmail query is precise and unreadable, and a rule nobody can interpret is a rule nobody will dare to edit |
| judge when a plan looks wrong and should be questioned rather than applied | a rule that suddenly matches ten times its usual volume is either a sender gone rogue or a rule that drifted, and nothing in the count itself says which |

## The flow

### 1. Fetch the sample — the agent does this, not the script

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

One narration line while fetching, then a table. Never paste raw thread JSON
into the conversation.

### 2. Propose — only on a first run, and it trashes nothing

```bash
node scripts/gmailtriage.js propose --threads threads.json --out candidates.json
```

Report **both** tables it prints. The withheld table is the interesting half —
it is where the user finds the sender they wanted a rule for, and why the skill
would not suggest one.

**Never argue with a withheld sender.** If the user wants it, they write the
rule; the guard constrains what the skill proposes, never what they may decide.

### 3. Accept rules

```bash
node scripts/gmailtriage.js rules --add candidates.json
```

Show the compiled Gmail query for each. A user who cannot see the query cannot
tell an over-broad rule from a precise one.

### 4. Plan — always, every run

```bash
node scripts/gmailtriage.js plan --threads threads.json --out plan.json
```

Report the per-rule counts and a preview. **If a rule suddenly takes many times
its usual volume, say so and stop** — that is either a sender gone rogue or a
rule that drifted, and nothing in the count says which.

### 5. Apply, then trash exactly what it authorised

```bash
node scripts/gmailtriage.js apply --plan plan.json --receipt <receipt.json>
```

It prints the authorised thread ids and writes the receipt. **Trash exactly
those ids and nothing else** — one `apply_sensitive_thread_label` with
`labelOption: TRASH` per id. A thread you trash that the plan did not name has
no rule behind it, which is the one thing this skill exists to refuse.

If you have already trashed and want the check after the fact, pass the ids as
`--trash <ids.json>`: `apply` exits non-zero naming any id the plan never
authorised, and writes no receipt.

### 6. Report, and say the undo

One table — rule, threads trashed — then the receipt path and the fact that
trash is recoverable for 30 days. Offer `undo`; do not bury it.

## Commands

| Command | Returns |
|---|---|
| `gmailtriage propose` | read a slice of the user's real inbox, cluster it by sender, list, and bulk-mail markers, and return a table of candidate rules — pattern, what it matches, how many threads in the sample, and a sample subject — so a first run starts from the user's own mail rather than from generic defaults. Proposes only; writes no rule and trashes nothing. |
| `gmailtriage rules` | read, validate and write the rule file, returning a table of rule id, action, the Gmail query it compiles to, and whether that query is well-formed — so a rule that would silently match everything or nothing is visible before it ever runs. |
| `gmailtriage plan` | evaluate every rule against the inbox and return the exact set of threads each rule would trash, as a table of rule id, thread count, sender and subject, plus a total and any thread matched by more than one rule. Reads only; trashes nothing. |
| `gmailtriage apply` | trash exactly the threads a named plan listed, refusing any thread the plan did not name, and write a receipt file recording every thread id it moved so the run can be undone. Returns a table of rule id, threads trashed, and threads skipped with the reason. |
| `gmailtriage undo` | read a receipt from a previous apply and restore every thread it trashed, returning a table of thread id, restored yes or no, and the rule that had taken it — so a run the user regrets is reversible without hunting through the Gmail trash by hand. |

## Rules that are not negotiable

- **A message is trashed only because a rule the user wrote matched it, and never because the model judged it junk — the model may propose a rule, but it may never act as one, so every trashed thread can be named by the rule that took it.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never trash a thread the plan did not name.** The plan is the authorisation;
  a thread outside it has no rule behind it.
- **Never propose a rule for a withheld sender.** Financial, medical,
  governmental, educational and recruiting senders, and any cluster carrying a
  login code, receipt or verification, stay withheld. The user may still write
  that rule themselves — the guard is on what the skill suggests.
- **Never call trash "deleted".** It is recoverable for 30 days, and saying so
  is the reason this is safe to run.
- **Never skip the plan.** Even on a run where nothing changed, the plan is what
  makes the trash attributable.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/gmailtriage.js` | the CLI: `propose`, `rules`, `plan`, `apply`, `undo` |
| `references/rules.md` | the rule format, what each field means, and the checks a rule must survive before it can trash anything |
| `references/safety.md` | why trash is never permanent deletion, what the receipt records, and how an unwanted run is undone |
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
