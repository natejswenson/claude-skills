# The Gmail surface this is built on

The MCP is **agent-side**. A node script cannot call it, so the division is
fixed: the agent fetches, trashes, labels and archives; `scripts/gmailtriage.js`
decides what a rule may take and refuses anything a rule did not name.

## The operations that exist

| Need | Tool |
|---|---|
| list threads by query | `search_threads` — Gmail query syntax, **50 per page**, paginate with `pageToken` |
| read one thread in full | `get_thread` |
| trash a thread | `apply_sensitive_thread_label` with `labelOption: TRASH` |
| restore a thread | `unlabel_thread` / `unlabel_message` removing `TRASH` |
| list the user's folders | `list_labels` — returns `{id, name, type}`; `type: "system"` are Gmail's own |
| create a folder | `create_label` — `Parent/Child` nests |
| file a thread | `label_thread` |
| archive a thread | `unlabel_thread` removing **`INBOX`** |
| un-archive a thread | `label_thread` adding `INBOX` back |

## The operations that do not exist

- **No permanent delete.** `TRASH` and `SPAM` are the only destructive labels.
- **No "move".** Gmail has labels, not folders. A move is `label_thread` plus
  `unlabel_thread` on `INBOX`, and doing only the first tags mail without
  sorting it. See `sorting.md`.
- **No header access.** There is no `header:` operator and no way to read
  `List-Unsubscribe` directly.
- **No batch anything.** One call per thread, per operation. A fifty-thread plan
  that files and archives is a hundred calls.

## Labels are ids in one place and names in another

`create_label` and `label_thread` take a **name**. `search_threads` returns
`labelIds` — opaque strings like `Label_15` for user labels — so a thread's
`labelIds` cannot be compared against a rule's destination without the mapping
from `list_labels`.

This is why `matches()` reads an optional `thread.labels` array of resolved
*names* and simply does not fire when the fetch did not supply them. The cost of
not knowing is one redundant `label_thread` call, which Gmail treats as a no-op;
guessing at the mapping would cost a thread filed in the wrong place.

## Two fields that are not where you expect them

`search_threads` with the minimal or metadata view returns `labelIds` **without
the `CATEGORY_*` labels** in the documented connector response. Ingest derives
positive category evidence by running category queries separately and
intersecting the ids:

```
in:inbox                      → the sample
in:inbox category:promotions  → mark those ids promotions
in:inbox category:updates     → mark those ids updates
```

A nonmember remains unknown: missing, partial, or limited searches cannot prove
primary. Ingest also accepts existing explicit category fields and legacy
`CATEGORY_*` labels; it does not synthesize those labels. All recognized sources
must agree. Promotion/update overlap, or disagreement with existing evidence,
produces `category: null` and a persisted conflict marker. Invalid evidence also
produces null and an unknown marker. Re-ingesting these markers cannot erase the
uncertainty. See `rules.md` for the vocabulary, aliases, and matching policy.

`hasUnsubscribe` is an **approximation**: ingest sets it true only for one known
promotions/updates category. Unknown, conflicting, and other categories set it
false. Matching additionally requires a literal true boolean and that same known
bulk evidence, so an old true boolean cannot override ambiguity. Gmail exposes
no header operator; this remains a structural proxy, never a header fact.

Ingest prints `category evidence: unknown=N conflict=N` to stderr, followed by
conflicting thread ids and bounded category tokens. Existing stdout tables are
unchanged. Ordinary snapshots retain seven fields; only ambiguity that null
would lose adds `categoryEvidence`, whose schema contains no message content.

This is worth knowing before adding a match field: if Gmail cannot express it as
a query, the skill cannot match on it either.

## Paginated input and source coverage

`ingest --manifest manifest.json --labels raw-labels.json --out-coverage coverage.json`
accepts this separately authored metadata; each `path` points to an unchanged,
verbatim raw response, relative to the manifest's directory or absolute:

```json
{
  "schema": 1,
  "sources": {
    "inbox": {
      "query": "in:inbox",
      "maxPages": 2,
      "maxThreads": 100,
      "pages": [
        { "path": "raw-inbox-001.json", "pageToken": null },
        { "path": "raw-inbox-002.json", "pageToken": "token-returned-by-page-1" }
      ]
    }
  }
}
```

The other source keys are `nolabel`, `promos`, and `updates`, using the queries
and views in step 1 of SKILL.md. Each source requires a nonempty query, positive
integer maxPages/maxThreads and an ordered pages array. A failed attempt uses
`{ "failed": true, "pageToken": "token-returned-by-page-1" }`, with no path or
raw error text. Missing sources remain unknown. Unknown source keys, malformed
records, mixed manifest/legacy thread flags, and over-cap inputs are refused.
The labels-only refresh accepts neither manifest nor thread/coverage output flags.

Count a failed attempt against maxPages and stop that source. Stop before another
request once attempts or unique threads reach their cap; request at most 50 and
no more than the remaining unique-thread allowance. Stop on repeated page tokens.
Do not splice pages, edit raw responses or fetch after mailbox mutations begin.
Fetch all intended category pages too: later-page membership is applied to the
inbox/nolabel sample, but category-only IDs do not enlarge that sample.

Coverage JSON has `{ "schema": 1, "sources": { ... } }`. Every source contains
`pages` (successful pages consumed), `uniqueThreads` (distinct returned IDs),
`state` and a bounded `reason`; manifest sources also carry maxPages/maxThreads.
The same counts/states appear in ingest's stderr coverage table; stdout remains
compatible. Coverage never copies tokens, raw paths, snippets, errors or estimates.

| State | Evidence |
|---|---|
| complete | Initial null request token, every continuation matches, and a successful terminal page has no nextPageToken. An empty terminal page or a terminal page reaching the cap still completes the chain. |
| capped | A continuation remains at the explicit page/thread cap, with no interruption evidence. This is an intentional sample. |
| interrupted | Retained continuation below caps, missing/unreadable/failed/malformed page, broken or repeated token, absent initial page, unexpected page after exhaustion, or no successful pages. These conditions outrank capped. |
| unknown | Source omitted, or legacy single-response inputs without request-chain provenance. No claim of exhaustion. |

Valid pages still contribute data across a gap, but a later terminal page cannot
repair the missing chain. An invalid response is not a successful empty page;
the connector's genuine empty object `{}` is supported. Complete describes the
supplied query at fetch time; concurrent mailbox activity can still change it.
Incomplete category coverage never proves nonmembership. Even complete category
fetches do not create primary evidence or change rule semantics. Carry this
coverage into the final run report using the saved `coverage.json`.

## Snippets carry secrets, and the estimate lies

Two facts about `search_threads` responses that shape how a run must handle
them:

**The default (minimal) view returns a `snippet` beside every subject**, and a
snippet is the opening of the message body — which for a security email IS the
verification code. On a real mailbox, live login codes entered the conversation
transcript this way twice. There is no view that returns subjects without
snippets, so the exposure at the fetch boundary cannot be avoided when subjects
are needed; what is controllable is everything after it. `ingest` never writes
a snippet to disk (structurally — the snapshot schema has no field for one),
and the agent never re-prints one. Use `THREAD_VIEW_METADATA_ONLY` for the two
category fetches, which need only ids: that view strips subject and snippet
both, which is also why it must never be used for the main fetches.

**`resultCountEstimate` is an estimate in the way weather is a forecast.** A
real fetch reported 68 and returned 6. Never repeat it as a count of anything;
the only numbers a run may claim are counts of threads actually returned.

## Recording host outcomes

Both Claude Code and Codex call Gmail on the host side. The Node CLI accepts only
this bounded envelope, never a raw tool body, snippet, error message, or credential:

```json
{
  "runId": "<receipt runId>",
  "outcomes": [
    {
      "id": "<authorized operation id>",
      "threadId": "<authorized thread>",
      "action": "add",
      "label": "Receipts",
      "status": "confirmed",
      "evidence": "success"
    }
  ]
}
```

Copy exact tuples from `receipt.operations`; `action` is `trash`, `add`, or
`remove`, and trash uses `label: null`. For `--begin` and `--retry`, omit status
and evidence. Never mark a whole block successful because its header succeeded.

| Observed host result | status / evidence |
|---|---|
| Definite success for this effect | confirmed / success |
| Definite failure establishing no effect | failed / no-effect |
| Timeout or lost response | unknown / timeout |
| Malformed, empty, or otherwise ambiguous response | unknown / ambiguous |
| Fresh read establishes the authorized effect occurred | confirmed / read-present, with --reconcile |
| Fresh read establishes the authorized effect did not occur | failed / read-absent, with --reconcile |

“read-present” means the **effect** is present: target membership exists for add,
source membership is absent for remove, or TRASH membership exists for trash.
“read-absent” means the opposite postcondition. Resolve opaque IDs through a fresh
label list. Read the affected thread after uncertainty; a cached snapshot cannot
reconcile Gmail. A failed operation also needs this fresh read before explicit
`--retry`. Confirmed effects are monotonic. After a timeout is recorded, ordinary
success recording is refused until reconciliation. Empty outcome arrays do not
complete anything.

Use the printed durable receipt path for every command; outcomes may live in the
session scratchpad. Pass `--labels labels.json` when binding opaque snapshots,
especially for merge source removal. Recovery replays only into that bound path.
Status/recovery show incomplete counts and never dispatch uncertain operations.
