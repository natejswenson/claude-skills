# Explicit-rule workflow

Use this workflow when no approved preferences are configured, or when the user chooses explicit sender rules. These commands retain their original behavior. Preference triage uses the main SKILL.md flow.

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
`unlabel_thread`, `apply_sensitive_thread_label`, `untrash_thread`. Load tool schemas once for the run.

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

**Claude and Codex use the same bounded fetch procedure.** Default per source:
`maxPages=1` and `maxThreads=50`; choose explicit larger positive integer caps
only when the run calls for a larger sample. Do not fetch an entire mailbox by
default. For each of the four queries above:

1. Before each request, stop if page attempts or distinct returned thread IDs
   have reached the configured cap. Request `pageSize=min(50, remaining unique-thread allowance)`.
   Count actual distinct IDs, never the requested size or `resultCountEstimate`.
2. Start without a page token. For each continuation use the exact returned
   `nextPageToken` as the next request's `pageToken`. Stop on a repeated token
   without another call; never infer exhaustion from a short page.
3. **Write each tool result to a scratchpad file VERBATIM** — new numbered files, verbatim,
   such as `raw-inbox-001.json`, `raw-inbox-002.json`, and likewise for
   nolabel/promos/updates. Byte-for-byte, exactly as the tool returned it: never
   transcribe a tool response by hand, never trim it, never restructure it or
   overwrite an earlier page. Save `list_labels` to `raw-labels.json`.
4. Record each attempt in a separate schema-1 `manifest.json`: source query,
   maxPages/maxThreads, ordered raw paths and request pageToken (null initially).
   A failed attempt counts against maxPages; record `failed: true` with its
   request token, omit the path and raw error text, then stop that source.
   See `references/gmail.md` for the complete manifest example and state rules.
5. Fetch all intended sources/pages and ingest coverage before any create_label,
   trash, label or archive operation can disturb pagination. Ingest refuses
   over-cap inputs; it never silently drops a supplied page to meet a cap.

Then one command does all the reshaping:

```bash
node $SKILL_DIR/scripts/gmailtriage.js ingest \
  --manifest manifest.json --labels raw-labels.json \
  --out-threads threads.json --out-labels labels.json \
  --out-coverage coverage.json
```

Legacy single-response `--inbox`/`--nolabel`/`--promos`/`--updates` inputs remain
supported, exclusively of `--manifest`. Their coverage is conservatively unknown
because request-chain provenance is absent. The source coverage table is on
stderr so existing stdout tables stay compatible.

It dedupes across the fetches, unions label ids, and combines positive category
search membership with existing category evidence. `hasUnsubscribe` remains a
bulk proxy (documented in `references/gmail.md`; do not present it as a header
fact). Missing evidence is unknown, never primary; conflicting or invalid
evidence cannot satisfy category or proxy rules. Sender-only rules still work.
Ingest reports unknown/conflict counts and conflicting ids on stderr. Ordinary
snapshots keep seven fields; ambiguity adds only a bounded `categoryEvidence`
marker with validated status/category tokens — **a snippet never reaches disk**.
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
| `SAME AS X` | two spellings of one folder, with mail split across both | `merge`, then separately verify whole-mailbox emptiness before authorized deletion |
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
see the query cannot assess the fetch, and a user who does not know a rule
archives will be surprised the first time their mail is not there. Queries
retrieve candidates; the local plan must enforce every matcher before any action.
New single-sender rules use `fromAddress`; domain clusters use `fromDomain`
with explicit rules for subdomains. Exact modes parse one complete mailbox,
exclude display names, and withhold malformed or ambiguous sender evidence.
They select an address, not SPF/DKIM/DMARC authentication. See `references/rules.md`.
**Read the warnings out loud**: every legacy `from` remains a substring,
including display names and lookalikes, even with an `@` prefix or a full address.
A trash rule ahead of an overlapping sort rule makes the order load-bearing.
Changing saved substring rules is the user's explicit choice; do not migrate them
silently.

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
failed operation that may require individual outcome recording and reconciliation.

### 4. Plan — always, every run

```bash
node $SKILL_DIR/scripts/gmailtriage.js plan --threads threads.json --labels labels.json --out plan.json
```

Report the per-rule counts, the per-folder counts, and a preview. **Say how many
threads would leave the inbox** — that is the number the user actually cares
about. **If a rule suddenly takes many times its usual volume, say so and stop**
— that is either a sender gone rogue or a rule that drifted, and nothing in the
count says which.

**Always pass `--labels`** to resolve opaque Gmail IDs and detect existing
destination labels. Plans accept only `in:inbox` (the default) or one
`label:<Folder>` scope; quote folder values containing spaces, for example
`--scope 'label:"Work Mail/Recruiting"'`. Scope membership is enforced before
matching rules. The summary retains the full scanned count and reports in-scope
and excluded rows with reasons. Inbox plans exclude archived, sent-only, trash
and spam rows, including trash/spam rows that also carry INBOX.

A supplied empty label array means no membership. Missing or malformed label
metadata, unresolved IDs needed for a folder pass, ambiguous folder mappings,
and unsupported searches refuse the plan before writing output. Re-fetch thread
labels and supply a fresh `--labels` map; do not broaden the scope to bypass it.

### 4b. The retroactive pass — applying new rules to mail already filed

New sub-label rules only ever see new mail. The mail already sitting in the
folder is what the user actually wants sorted, and it is out of the inbox, so
the default scope cannot reach it:

```bash
node $SKILL_DIR/scripts/gmailtriage.js plan --threads filed.json --labels labels.json \
  --scope 'label:<Folder>' --out plan.json
```

The planner checks exact membership of the named folder; a descendant label
alone is not membership. Keep rules still win. Only label rules participate,
and excluded trash or other nonadditive rules are reported separately.
**"Would leave the inbox" is always 0**, even for folder members still in INBOX.
Only missing destination labels are added; **nothing is trashed, unlabelled or
archived**. Existing parent labels and INBOX membership stay intact.

After recording all confirmed label effects, re-run the same command. **It must take zero threads after confirmation.** Before confirmation, the snapshot remains unchanged.

### 5. Apply, then perform exactly what it authorised

```bash
node $SKILL_DIR/scripts/gmailtriage.js apply --plan plan.json --update-threads threads.json --labels labels.json
```

**Do not pass `--receipt`.** The receipt defaults to
`~/.gmailtriage/receipts/<timestamp>.json` — the durable store `undo --last`
reads — and the path is printed. Keep receipts durable so scratch cleanup
does not remove undo evidence.
`--update-threads` binds the working snapshot but leaves it unchanged at authorization.
The version-2 receipt contains immutable authorized entries and individual pending
operations: trash, add each label, and remove each label (including INBOX).
Entries describe intent; only confirmed operations describe execution.

**Claude Code and Codex follow the same outcome protocol.** Read
[the outcome envelope](references/gmail.md#recording-host-outcomes) before calling Gmail:

1. Copy the receipt's `runId` and the selected operations' exact
   `id/threadId/action/label` tuples into `outcomes.json`. Run
   `record --receipt <path> --outcomes outcomes.json --begin` **before** the calls.
   It marks attempts unknown durably and refuses unconfirmed dependencies.
2. Execute only the begun operations through the host Gmail tools: trash with
   `apply_sensitive_thread_label`, add with `label_thread`, remove with
   `unlabel_thread`. Parallel calls within one block are allowed; persist results
   serially through one receipt writer. Confirm all target additions for a thread
   before beginning its archive or merge source removal.
3. Record each operation's bounded outcome with
   `record --receipt <path> --outcomes outcomes.json`. Definite success is
   `confirmed/success`; definite no-effect failure is `failed/no-effect`.
   Timeout and ambiguous or malformed responses are `unknown/timeout` or
   `unknown/ambiguous`. Empty results never establish success.
4. Inspect `record --receipt <path> --status`. Unknown and failed operations
   require a fresh host membership read and `--reconcile`. Only after fresh
   no-effect evidence may `--retry` explicitly prepare a pending operation.
   Never re-run apply or merge as a retry. If snapshot replay failed, restore
   its bound path and use `--recover`; status is read-only.

The receipt is committed before confirmed effects replay atomically onto the
snapshot. Duplicate confirmation is idempotent; an interrupted replay can recover.
A lock refuses concurrent writers; if a writer died, verify it is stopped before
removing its stale `<receipt>.lock` directory. Never discard an uncertain receipt.

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

Read the saved `coverage.json` from step 1 and include a concise source coverage
table: successful pages, observed unique threads and complete/capped/interrupted/
unknown for inbox, nolabel, promos and updates. Describe capped sources as an
intentional sample and interrupted/unknown sources as incomplete. Disclose
incomplete category coverage: absence from those pages does not prove
nonmembership, primary status or permission for a bulk rule. Complete means the
query chain was exhausted when fetched, not an atomic mailbox snapshot.

Report confirmed operations and affected threads separately from pending, failed,
and unknown operations, using `record --status`. Zero Gmail calls means zero
confirmed operations; authorization alone cannot report success. Then show the receipt path (under
`~/.gmailtriage/receipts/`, where it outlives this session). Say plainly that
**nothing was deleted**: trash is recoverable for 30 days, and a filed thread
is one label away from where it was. Offer `undo --last`; do not bury it.
