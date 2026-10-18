# Optional local label advice

Use this mode only when the user requests local suggestions. Codex or Claude
still orchestrates the run, reviews suggestions with the user, and follows the
existing rules, audit, plan, apply and receipt workflow. Ordinary runs never
start a classifier. This command never reads Gmail or changes rules or mail.

## Local setup

Install the external classifier and its Python environment separately. No model,
weights, Python packages or network installer ships in this plugin. Configure
`~/.gmailtriage/local-model.json` (or pass `--config`) with exactly these fields;
replace the illustrative paths with existing absolute local paths:

```json
{
  "version": 1,
  "python": "/absolute/environment/bin/python",
  "script": "/absolute/classifier/decide.py",
  "modelDir": "/absolute/cached-model"
}
```

The first two paths must be files and the last a directory. The Python runner
must support the documented request/response schema and have its model cached.
Inference receives `HF_HUB_OFFLINE=1`, `HF_HUB_DISABLE_IMPLICIT_TOKEN=1` and
`TRANSFORMERS_OFFLINE=1`; configure the external runner for local-only loading.
The command uses `execFile` without a shell, a 90 second timeout with SIGKILL,
and a 1 MiB output limit. Failure messages never forward runner diagnostics.
Offline environment flags are a loading contract, not a network sandbox for an
arbitrary executable; configure only a runner you trust.

## Per-run choices and invocation

After `propose`, prepare a choices array using the current ingested label
snapshot. Choices have exactly `label` and `description`; names must match
unique existing user labels exactly. Supply 2..12 choices with nonempty
descriptions of at most 200 Unicode characters. Refresh stale labels rather
than inventing a destination. For example, if both labels exist:

```json
[
  {"label":"Work","description":"Employment and professional correspondence"},
  {"label":"Learning","description":"Courses and educational correspondence"}
]
```

In either host, resolve `SKILL_DIR` from the loaded skill and use a session
scratch directory outside any Git repository. Keep all snapshots and choices
there, following the existing ingest flow:

```bash
node "$SKILL_DIR/scripts/gmailtriage.js" suggest-local \
  --threads "$SESSION_DIR/threads.json" --labels "$SESSION_DIR/labels.json" \
  --choices "$SESSION_DIR/choices.json" --scratch-dir "$SESSION_DIR" \
  --out "$SESSION_DIR/suggestions.json"
```

Rules default to `~/.gmailtriage/rules.json`; absence means an empty set and
present rules must validate. `--min-count` defaults to 3 and must be a positive
integer. The optional output is written only after complete response validation;
without `--out`, only a human table and counts are printed. Output must use a
new unused path on each run; input aliases and existing paths are refused before
inference, and exclusive creation prevents overwriting a file created mid-run. Scratch must already
exist. Scratch and output refuse Git paths, including symlink aliases, even
with `--allow-repo`. Each request uses a unique directory (0700) and request
file (0600), removed in `finally`; unrelated scratch files are preserved.

## What crosses the boundary

Eligibility comes directly from `propose`: sortable senders with no existing
deterministic destination and no inbox-preservation requirement. Existing rules,
ambiguous senders, self-sent mail and sensitive subjects anywhere in a sender
cluster retain the existing exclusions. Recruiting or education senders can be
eligible when the existing proposal allows sorting. No eligible senders returns
an empty advisory result without launching the runner.

The request contains opaque item IDs, resolved senders, one sample subject per
eligible sender, and opaque choice IDs with descriptions. It carries no Gmail
IDs, snippets, bodies, excluded metadata or arbitrary snapshot fields. Sender,
subject and ID limits are 254, 160 and 64 Unicode characters. At most 20 senders
are allowed. Overflow fails; use a smaller sample. Nothing is truncated or
silently selected from an oversized batch.

The adapter validates exact fields, model ID/revision, schema version 1,
`scoreKind: uncalibrated_entailment`, `calibration: none`, exact item/choice
membership, and every finite numeric score in [0,1]. It independently computes
suggestion or abstention with fixed minimum score 0.8 and margin 0.2. Ties,
low scores or close scores abstain. Independent scores need not sum to one.
Declared decisions, reasons, chosen IDs and arithmetic must agree with that
policy; unexpected action fields are refused. Arithmetic comparisons allow
1e-6 tolerance, which never lowers an acceptance threshold.

The table columns are Candidate, Sender, Suggestion, Top score, Margin and
Result. Output has `kind: local-label-suggestions`, model provenance, thresholds,
counts and advisory suggestions, with deterministic senders and no subjects.
Scores are uncalibrated heuristics, not probabilities. This output is not an
importable rule document. Model judgment remains external and fallible. Review
each destination with the user, then use existing rule validation and planning;
a suggestion never authorises filing, archiving, trashing or suppressing audit.


## Explicit local learning feedback

Ask the user for the preferred category among the offered descriptions, or
explicitly **none of these**, and confirm that the other offered categories are
incorrect before capturing. Existing Gmail labels and model predictions are
never gold until this confirmation. Rejection, skipping, silence and abstention
are not a none selection. `suggest-local` never captures feedback implicitly.

Prepare the review batch in a private file (0600) outside Git. It has exactly
`{"schemaVersion":1,"examples":[record,...]}` with 1..200 records. Each record
has exactly `schemaVersion:1`, a UUID `eventId`, `confirmed:true`, `source`
(`filed-mail-review` or `triage-review`), `sender`, `subject`, `choices`,
`selectedChoiceId`, and `sourceId`. Sender must be a canonical lowercase bare
address, at most 254 characters. Subject is nonempty, at most 160 Unicode
characters, and must pass the existing protected-subject guard. Bodies,
snippets and raw Gmail IDs are forbidden. Choices are 2..12 exact objects with
unique `id` (nonempty, at most 64 characters) and unique `description` (nonempty,
at most 200 characters). `selectedChoiceId` must be one offered ID or JSON null
for explicitly none. No extra fields are accepted.

Compute `sourceId` as lowercase SHA256 of UTF8
`JSON.stringify([sender.toLowerCase(),subject])`: compact JSON, literal Unicode,
no normalization or truncation. Reuse the same event UUID for retries. The
external trainer deduplicates this source identity so repeated mail does not
increase its training weight; conflicting categories or choices are refused.

```bash
node "$SKILL_DIR/scripts/gmailtriage.js" learn-local \
  --input "$SESSION_DIR/review-batch.json"
```

Optional `--store PRIVATE_DIR` defaults to `~/.gmailtriage/learning/feedback`.
The directory must be private (0700); immutable individual `<eventId>.json`
files are 0600. Files and directory must be owned by the current user. Git
paths, symlink files, hardlinked files, non-private existing paths and event
rewrites are refused; `--allow-repo` is unsupported. A retry of identical event
data is idempotent. Output contains only `captured` and `existing` counts.
Validation and event conflict checks precede new writes; an interrupted batch
can be retried. Retain this private store only as long as wanted and remove
unwanted records deliberately outside the capture command. It contains mail
metadata and must stay outside Git and uploads.

Capture changes no rules or Gmail state and runs no training. To train the
separately installed local alternative with its existing Python environment:

```bash
/absolute/environment/bin/python /absolute/classifier/train.py \
  --feedback-dir "$HOME/.gmailtriage/learning/feedback" \
  --model-dir /absolute/cached-model --out-dir /absolute/private/new-candidate
```

Training requires at least two selected categories, each represented by at
least two distinct senders, and a whole-sender holdout. Insufficient evidence
returns not-ready. Training leaves the base unchanged and creates a separate
inactive candidate plus a count-only evaluation report. Holdout evidence is
never used for fitting or tuning. Scores remain uncalibrated and small samples
do not establish production quality. Inspect the report before any separately
authorized activation; neither capture nor training activates a candidate.
