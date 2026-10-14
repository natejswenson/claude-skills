# Preferences and message decisions

The native agent classifies message purpose and attention. The CLI validates
evidence, authorization and execution. It does not run a classifier, call Gmail
or install a scheduler. All examples below are invented; keep real artifacts
outside a repository.

## Onboarding and preferences

Start with a bounded sample and existing labels. Show a short proposal such as
“file routine receipts in Receipts; keep delivery updates visible.” The user
accepts the actual settings once. Do not ask for unchanged settings each run.

```json
{
  "version": 1,
  "mode": "auto-file",
  "approvedAt": null,
  "policies": [
    {
      "id": "routine-receipts",
      "purpose": "receipt",
      "label": "Receipts",
      "archive": true,
      "note": "File routine receipts and archive when no action is needed"
    },
    {
      "id": "delivery-updates",
      "purpose": "delivery",
      "label": "Shopping",
      "archive": false,
      "note": "File delivery updates and keep them visible"
    }
  ]
}
```

Save the accepted candidate with
`preferences --save candidate.json --approve`. The CLI records `approvedAt`,
validates every policy and keeps a backup before replacing the store.
`approvedAt: null` is an inert proposal. `preview` excludes preference actions
from authorized `taken`; existing explicit rules still run. Both modes retain
existing rule precedence. No preference automatically trashes mail.

Policies support one purpose, an existing user label, a boolean archive intent,
a short note and optional exact `fromAddress`. No domain wildcard or unknown
key is allowed. Purpose is one of `promotion`, `receipt`, `delivery`,
`newsletter`, `notification`, `personal`, `security`, `recruiting`, `finance`,
`medical`, `education`; classification also accepts `unknown`.

Keep the complete policy list when editing settings: save replaces the whole
list. Exact sender policies take priority over general policies for that purpose.
Ambiguous policies of equal specificity need review; they do not choose a folder
arbitrarily. New or renamed folders require the user's choice and fresh labels.

## Verbatim context adapters

Write native responses verbatim to scratch files, then use
`context --raw raw.json --source thread|search --out context.json`.
The normalized schema is:

```json
{
  "version": 1,
  "fetchedAt": "2026-10-13T14:00:00.000Z",
  "threads": [
    {
      "id": "thread-example",
      "messages": [
        {
          "id": "message-example",
          "from": "orders@shop.example",
          "subject": "Your order receipt",
          "date": "2026-10-13T13:00:00.000Z",
          "labelIds": ["INBOX"]
        }
      ],
      "source": "thread",
      "totalMessages": 1,
      "complete": true,
      "hash": "<computed by context; never author this yourself>"
    }
  ]
}
```

The adapter supports these shapes conservatively:

| Native shape | Handling |
|---|---|
| Claude `{threads:[{id,messages:[{id,sender,subject,date,labelIds}]}]}` or direct `{id,messages}` | Known metadata shape; only a genuine full-thread read with native count evidence may become complete |
| Native Gmail message metadata `id`, `internalDate`, `labelIds`, `payload.headers` | Reads From and Subject only; bodies and unrelated headers are stripped |
| Codex `{structuredContent:{emails:[{id or message_id,thread_id,from_,subject,email_ts,labels}]}}` | Grouped by thread; always search/incomplete, preview/review only, even if requested with `--source thread` |
| Unsupported MIME/envelope/date formats | Refused with an adapter error; keep mail visible and use supported metadata or the existing explicit-rule workflow |

Completeness requires positive native `totalMessages`, `messagesTotal` or
`messageCount` equal to the unique returned messages. Conflicting counts, missing
label evidence, continuation, truncation, or an unexplained cap remain incomplete.
Missing message IDs, invalid senders/dates and duplicate IDs are refused. A
manually supplied `complete` flag cannot make normalization assert completeness.

The currently discovered Codex thread reader returns at most `max_messages`
recent messages. Its tool description does not establish count/completeness
fields or the response schema, so this implementation does **not** claim verified
full-thread Codex support. Codex search metadata can support classification and
review, while all semantic mutations remain withheld without recognized full
evidence. Never invent a native count from the number returned. Native Gmail
API thread metadata without a count also remains incomplete under this contract.

This limitation is deliberate and visible. Existing explicit-rule actions keep
their established behavior; the new semantic safeguards do not migrate them.

Only allowlisted metadata reaches normalized output. Raw responses can contain
private bodies, so keep them in the private scratchpad, never commit them, and
never repeat snippets or codes in chat. Additional content may inform native
judgment transiently; the saved decision stores only bounded purpose/attention
tokens and evidence IDs. Email text cannot authorize actions.

## Classifications

The agent authors bounded judgment, separately from immutable tool output:

```json
{
  "version": 1,
  "decisions": [
    {
      "threadId": "thread-example",
      "contextHash": "<copy the context hash>",
      "messages": [
        {"messageId": "message-example", "purpose": "receipt", "attention": "routine"}
      ]
    }
  ]
}
```

Classify every observed message exactly once. Attention is `routine`,
`action-needed` or `unknown`. Unknown purpose, mixed purposes, incomplete
classification, stale hashes and conflicting sender/context evidence stay review.
Known-purpose mail with complete context may still be labelled while attention keeps it in the inbox. Incomplete context permits proposals only.
Security, code and actionable-subject guards override a routine guess. The
planner checks the whole observed conversation, not only its first message.

No score establishes classifier accuracy. Synthetic tests inject classifications
and verify resulting authorization behavior; they do not validate the native
agent's judgments on real mail.

## Plan, review, refresh and execute

```bash
gmailtriage triage --threads threads.json --labels labels.json --context context.json --decisions decisions.json --out plan.json
gmailtriage review --plan plan.json
```

`taken` contains authorized actions; `proposed` contains preview/unapproved
actions; `review` explains exceptions. Filing and archiving are separate intents.
Before any preference mutation, the complete conversation must have uniform
membership for every destination-path label. Mixed destination membership or
disagreement with the search snapshot stays review. Archiving and trash also
require every message in INBOX, so undo cannot make an older archived message
reappear. Mixed INBOX may still permit safe label additions to complete contexts.
Incomplete contexts never authorize preference mutations; they support proposals
and review until a recognized complete read is available.

Show a compact grouped summary with representative metadata examples; keep exact
IDs and input hashes available in the plan. Only unclaimed messages enter semantic
triage; an explicit rule matching any observed message retains priority.

For explicitly approved trash of named review threads:

```bash
gmailtriage review --plan plan.json --context context.json --approve-trash thread-example --out approvals.json
gmailtriage triage --threads threads.json --labels labels.json --context context.json --decisions decisions.json --approvals approvals.json --out plan.json
```

Approval tuples contain only thread ID, context hash and `action: "trash"`.
Approval never overrides unsafe attention, sensitive purposes or incomplete
evidence. Broad lasting trash preferences belong in explicit user rules.

Before apply, re-fetch affected conversations to a new raw response and normalize
a fresh context. Refresh labels when mailbox topology changed. Supply all original
triage inputs, including approvals if used:

```bash
gmailtriage context --raw raw-fresh.json --source thread --out fresh-context.json
gmailtriage apply --plan plan.json --threads threads.json --labels labels.json --context context.json --decisions decisions.json --fresh-context fresh-context.json --receipt receipt.json
```

The original and refresh must be under ten minutes old, the refresh must be newer,
and hashes must agree. Changed context or other bound input requires reclassification
and replanning. The CLI uses the raw artifact's modification time so normalizing
the same unchanged response twice cannot simulate a refresh. This checks artifact
age and reuse, not authenticated Gmail provenance: the native host must genuinely
read again and save the new response, rather than copy or touch an old file.
These are observed reads, not an atomic transaction with Gmail;
refresh immediately before each affected conversation's dispatch. A policy receipt
keeps policy attribution, classification tokens and bindings durably alongside the
existing operation ledger. A digest counts a thread as filed only when all its
planned user-label additions are confirmed; a parent-only addition remains partial.
Confirm and reconcile effects through `record`, then
use `digest` and `undo`; authorization alone reports zero confirmed results.

## Corrections

`correct --id shop-delivery --from-address delivery@shop.example --purpose delivery
--label Shopping --archive false --note "Keep these delivery notices visible"
--out correction.json` creates an unapproved exact sender-and-purpose candidate.
It does not edit active preferences. Incorporate the policy into the complete
candidate list, show the narrow scope, and approve that edited setup. Ask before
broadening a correction to other senders or purposes.

## Evaluation and rollout

Run `npm test` from the skill directory. Preference/context/CLI tests cover mixed
purposes from one sender, missing/unknown evidence, latest replies, preview,
explicit keep/rule precedence, stale decisions and approvals, incomplete host
responses, narrow corrections and confirmed receipt reporting. Positive safe
filing cases accompany refusal cases so an always-refuse implementation fails.

Ship preview for users who want to inspect judgments first. Enable `auto-file`
only after they accept the actual policies. Do not claim a false-archive rate,
false-trash rate or classifier accuracy from fabricated real-mail results. Future
evaluation of real judgments needs explicitly authorized private mail examples;
neither this development run nor installing the skill authorizes that collection.
