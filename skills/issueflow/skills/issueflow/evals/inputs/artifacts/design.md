# Design — natejswenson/local-fitness #133

**MCP audit: tool descriptions promise behavior the handlers don't deliver**

Repo: `/Users/natejswenson/localrepo/local-fitness` · base `main` · read at `dev` @ `d4938fb` (0.43.0).
Inherits: `investigate.md` (6 items already fixed in 0.32.0/0.38.1, 12 open, 2 recommended won't-fix).

---

## One correction to the inherited investigation

I am implementing investigate's per-item evidence as approved. One summary
sentence in it is narrower than its own findings, and I am recording that rather
than designing around it:

> §B's header — "Still open (12 items) — **every one is a *description* string, not a handler**."

Two of the twelve are handler behaviour, and investigate itself says so further
down:

- **§B.9** (`days=0` on `query_workouts` removes the date predicate) — §C.1
  explicitly promotes this above "description fix": *"this is not a default
  substitution, it is an unbounded table scan returned to the model as if it
  answered a bounded question."*
- **§12b** (`revise_training_plan` skips revalidation on goal-field-only edits) —
  moving `race_date` earlier leaves workouts dated after the race. No description
  can make that correct; it is a missing validation branch.

I also disagree on one item's cheapest fix — **§B.4, `query_workouts` not
returning `source`**. Investigate files it as a description gap. Adding one
column to an existing SELECT is smaller than the paragraph that would otherwise
have to teach the model to infer manual rows from the *sign of an integer id*.
That is a fix, not a doc. Called out here so it is a decision, not a drift.

Everything else lands exactly as investigate scoped it, including both
recommended won't-fixes.

---

## Approach

**The description string is the contract. Bring every open item's `description=`
up to what its `docs/mcp/` page already says; fix the four items where changing
the truth is cheaper than describing it; and pin each corrected clause with a
two-sided `DESCRIPTION_CONTRACT` gate in the drift-test module this repo already
has.**

Three parts.

### 1. The root cause is that nothing executes a description

`docs/mcp/` was added by the same 0.26.0 audit that filed #133, and it is
*correct* — every open item is already written up as a gotcha there, verified
page by page. But the pages are a human reference and the model never sees them.
The `description=` string is the only prose that reaches the agent, and nothing
in CI reads it. That is why twelve documented gotchas sat undelivered for six
weeks, and it is why fixing the twelve strings without a gate fixes this issue
exactly once.

`tests/test_docs_drift.py` already exists for precisely this failure mode, and
its own docstring states the method: *"Each check pins the actual claim sentence,
not a loose number match, so editing the wording is a deliberate act that shows
up as a failing test."* It currently pins page existence, availability phrasing
and printed counts. It gains a `DESCRIPTION_CONTRACT` table: tool name → the
clauses its description must carry, and the clauses it must **not**.

Two-sided by construction, because a one-sided version rots the day someone
rewrites a description:

- **Positive:** `get_metric_trend`'s description must say the slope basis is
  per *observation*.
- **Negative:** `_DAILY_SNAPSHOT_DESCRIPTION` must **not** contain
  `trend-related` — that is the exact clause that sends the model to
  `BriefContext.trends`, a field carrying no trend.

Plus two anti-vacuity guards, since a substring table is easy to make decorative:

- every key in the table must be a registered tool name (a typo'd key pins
  nothing and passes forever);
- the table must cover **at least** the tools this issue touched (a floor
  constant), so deleting an entry to make a test green fails a different test.

### 2. Four items are fixed, not described

| Item | Why fixing beats describing |
|---|---|
| §B.9 `query_workouts(days=0)` | Silently drops `date >= ?` entirely. Investigate reproduced 500 rows back to **2023-07-06** for a call meaning "today". `_validate_limit`'s shape (`None` → default, anything else validated) is already the house pattern — copy it. |
| §B.4 `source` not returned | One column in a SELECT, already declared in `QUERYABLE_SCHEMA`. The alternative is prose teaching the model that a negative `activity_id` means manual. |
| §12b `revise_training_plan` | Validation runs only when `workouts` is passed. A goal-only edit can strand workouts after the race date. |
| §12a `plans.score_plan` dead | Defined, unit-tested, never called. `propose_training_plan`'s description says "Ground it first" and nothing grounds anything. Wire it **advisory** — attach the score to the draft payload, do not reject. |

### 3. Two items close as won't-fix, deliberately and visibly

- **`lookback_days=0` still defaults** (§B.8) — a recorded decision in
  `docs/mcp/find_anomalies.md` ("That falsy-fallback was left alone"). Left alone
  again. But after §B.9 lands, `days=0` errors while `lookback_days=0` defaults,
  and an undocumented inconsistency is how a deliberate decision becomes drift.
  **Both behaviours get pinned in the contract table**, so the asymmetry is a
  test someone has to argue with rather than a thing they discover.
- **`training_load_status`'s fifth TSB outcome** (§B.5) — structurally reachable,
  empirically not: `ingest/baselines.py` writes `(ctl, atl, ctl-atl)` as a triple,
  and the live 1 599-row DB has zero rows with `ctl IS NOT NULL AND tsb IS NULL`.
  The fix is one docstring in `interpret.tsb_zone`, which currently asserts a
  reachability the data contradicts — **not** a defensive branch in the tool.

Also in scope and easy to lose: **the six items already fixed in 0.32.0/0.38.1**
and the issue's now-wrong triage line ("the `sync_garmin_data` recompute gate and
the `get_brief_context` continuity promise are the two worth fixing"). Anyone
starting from that line re-fixes fixed code and risks reintroducing the
`status == "success"` gate the current comment warns against. The close-out
comment on #133 enumerates fixed-already / fixed-here / won't-fix, and ships with
the last work item.

---

## Rejected

**1. Generate the descriptions from `docs/mcp/`.** Investigate left this open
("whether `docs/mcp/` should be the source the descriptions are generated from…
a design question for the next stage"). Rejected. The two artefacts have
different audiences and different budgets: 46 descriptions are loaded into
*every* model session and must stay one to three sentences; the pages are
100–200-line references with parameter tables and worked examples
(`docs/mcp/correlate.md` is 8 gotchas long). Generating one from the other means
either shipping page prose into the context window, or inventing a
marker-region convention inside markdown plus a codegen step plus a gate on the
generated output — more machinery than the twelve-item problem justifies, to
prevent exactly the failure a ~40-line substring table catches. Revisit if a
third surface ever needs the same prose.

**2. Document everything, change no behaviour.** This is what the original audit
did, and it is what produced this issue. Four items are cheaper to fix than to
describe (table above); documenting an unbounded table scan is worse than not
performing one.

**3. Rename `slope_per_day` → `slope_per_sample`.** The issue offers
"either rename it or document the caveat". Rename is the only payload-breaking
change in the whole set — the key is referenced by the rounding table at
`tools.py:489`, by `tests/test_tools.py:757,765`, and by a design doc. Document
the caveat in the description instead: *"per observation of the null-filtered
series, not per calendar day."* Investigate's own repro is the sentence to
encode — `vo2_max` over 30 days returned `n_samples: 3`, where one "day" of slope
is roughly ten calendar days.

**4. Make `score_plan` a hard gate on `propose_training_plan`.** Rejected for
this change. It turns a model-authored plan that ramps 16% in one week into a
hard error with no override, on a write path a user is mid-conversation with.
Ship it as an advisory `quality` block first; if a bad score ever actually
appears in real use, promoting it to a gate is a one-line follow-up with
evidence behind it.

**5. Add a defensive `tsb is None` branch to `training_load_status`.** Rejected:
the branch is unreachable against every writer in the repo and every row in the
live DB, so it would be untestable except by hand-crafting a row no code path
produces — coverage theater in a repo whose CLAUDE.md bans it. Correct the
docstring that claims otherwise.

**6. Land it as one PR.** Rejected — see below.

---

## Files

### Work item 1 — `descriptions` (zero behaviour change)

| File | What happens |
|---|---|
| `src/local_fitness/agent/tools.py` | Eight description strings rewritten, no handler touched: **`_DAILY_SNAPSHOT_DESCRIPTION`** (~296-304) — drop "or anything plan-/trend-related"; plan reads → `get_brief_context`, trend *statistics* → `get_metric_trend`, and say the 7-day arrows are already in *this* payload. **`get_metric_trend`** (~403-410) — `slope_per_day` is per observation of the null-filtered series; do not multiply by a day count. **`compare_periods`** (~1031-1044) — name `cohens_d` and `magnitude` (and that `delta_pct` rides along outside the SUM branch); the effect-size read is the headline. **`correlate`** (~1396, currently one sentence) — hard 5-pair floor returns an error, and `n_pairs` can exceed `days` because the cutoff widens by `|lag|+1` without re-restricting pairing; read `n_pairs`. **`recovery_pattern`** — `n_workouts_matched` is the count *after* the baseline skip, read beside `n_skipped_no_baseline`. **`sync_garmin_data`** (~1248-1256) — `SYNC_MAX_DAYS = 30` per call, and `fitness pull` (CLI) has no cap, so the two diverge after a long absence. **`update_plan_workout`** (~2597-2599) — delete "use it to move a long run, swap days"; it re-prescribes an existing day only, cannot add or move a date, and moving a long run is two calls that only work if the target day is already on the plan. **`propose_training_plan`** (~2483-2488) — the validation floor is `db.last_known_daily_date()`, the data frontier, which with a stale sync sits behind today. |
| `src/local_fitness/agent/interpret.py` | `tsb_zone` docstring (~84-85): replace the "reachable on `training_load_status`" claim with the measured truth — `baselines` writes ctl/atl/tsb together, so the sentinel is a defensive default, not an outcome to expect. |
| `docs/mcp/*.md` (10 pages) | `get_today_status`, `daily_snapshot`, `get_metric_trend`, `compare_periods`, `correlate`, `recovery_pattern`, `sync_garmin_data`, `update_plan_workout`, `propose_training_plan`, `training_load_status`. **Verify-then-touch, not rewrite** — most already carry the gotcha verbatim; only the places where a page and its new description now disagree change. |
| `tests/test_docs_drift.py` | New section: `DESCRIPTION_CONTRACT` (name → required clauses, forbidden clauses, each commented with its #133 item), the parametrized assertion over it, and the two anti-vacuity guards. |
| `CHANGELOG.md`, `pyproject.toml` | Version bump — descriptions are prompt surface, and this repo's release policy is code/prompt change ⇒ bump. CHANGELOG entry names #133 and lists the six items 0.32.0/0.38.1 already fixed, so the next reader does not re-fix them. |

### Work item 2 — `query-workouts-honesty`

| File | What happens |
|---|---|
| `src/local_fitness/agent/tools.py` | `query_workouts` handler: `source` joins the SELECT list (~936-939) — it is already in `QUERYABLE_SCHEMA:99`. `days` moves from `if args.get("days"):` (~908) to present-and-not-`None` → `_validate_days`, mirroring `_validate_limit` — explicit `0` becomes the error `days must be between 1 and 3650` instead of dropping the predicate. `min_duration_min` likewise honours an explicit `0` as `duration_seconds >= 0` rather than ignoring it, matching what `_min_distance_meters` already does for its sibling. Description gains `source` (`'garmin'` / `'manual'`) and the `days` bound. |
| `docs/mcp/query_workouts.md` | Two gotchas currently document the old behaviour and must change with it: *"Falsy `days` and `min_duration_min` are still silently ignored"* and *"Manually-logged workouts are included and not labelled"*. Returns table gains `source`. **This page is the reason the drift gate cannot be the only proof — a page can document a bug faithfully.** |
| `tests/test_tools.py` | Regression tests (below). |
| `tests/test_docs_drift.py` | `query_workouts` entry added to `DESCRIPTION_CONTRACT`; the `find_anomalies` / `recovery_pattern` `lookback_days=0` won't-fix pinned alongside it, so the asymmetry is recorded. |
| `CHANGELOG.md`, `pyproject.toml` | Bump + entry. |

### Work item 3 — `plan-tool-truth`

| File | What happens |
|---|---|
| `src/local_fitness/agent/tools.py` | `revise_training_plan` (~2545-2558): the `if workouts is not None:` gate widens — when `workouts` is absent but any goal field (`race_date`, `goal_type`, `goal_distance_m`, `target_time_seconds`) is being edited, load the plan's stored workouts via `plans.get_plan(plan_id)` and run `validate_plan_input` against the *merged* goal fields. `propose_training_plan` (~2491-2517): call `plans.score_plan(workouts, race_date)` and attach the result to the payload as an advisory `quality` block; description states the deterministic structural read (ramp ≤15%/week, taper) and that it is advisory, not a gate — replacing the unbacked "Ground it first" implication. |
| `docs/mcp/propose_training_plan.md`, `docs/mcp/revise_training_plan.md` | Returns table gains `quality`; the "score_plan is dead code" gotcha is deleted (it stops being true); the revise page's revalidation gotcha is replaced by the new rule. |
| `tests/test_plan_tools.py` | Regression tests (below). |
| `tests/test_docs_drift.py` | Both plan-tool entries updated in the contract table. |
| `CHANGELOG.md`, `pyproject.toml` | Bump + entry. |

### Work item 4 — `dead-notes-param`

| File | What happens |
|---|---|
| `src/local_fitness/agent/brief_planner.py` | `assemble_brief_context`'s `notes: str | None = None` parameter deleted (~757-759); the body (757-833) never reads it. Both production callers (`web/mcp_server.py:303`, `agent/tools.py:3183`) and all 23 test call sites pass it never — verified by grep, so this is a signature change with no call-site churn. |
| `tests/test_brief_planner.py` | One assertion that passing `notes=` now raises `TypeError` (below). |
| `CHANGELOG.md`, `pyproject.toml` | Bump + entry. Carries the #133 close-out comment. |

---

## Proof

Every row below is phrased as "this test fails on today's code and passes after".

### Behaviour — the four items being fixed

| # | Issue item | The assertion |
|---|---|---|
| P1 | §B.9 `days=0` scans the whole table | `query_workouts(days=0)` returns `{"error": "days must be between 1 and 3650"}`. Today it returns the entire `activities` table row-capped — investigate reproduced 500 rows whose oldest is **2023-07-06**, with `truncated: true`, for a call a model would make meaning "today". A companion case pins `days=1` still returning only today's row, so the fix is a rejection of `0`, not a bounds regression. |
| P2 | §B.4 manual rows indistinguishable | Seed one Garmin activity and one `log_manual_workout` row; `query_workouts()` returns both with `source == "garmin"` and `source == "manual"` respectively. Today `source` is absent from the payload entirely and the only tell is the sign of `activity_id`. |
| P3 | §12b `revise_training_plan` skips revalidation | On a draft whose last workout is dated 2026-10-10, `revise_training_plan(plan_id, race_date="2026-09-01")` **with no `workouts`** returns an error naming the out-of-range workout. Today it returns `{"plan_id": …, "status": "draft"}` and the plan is left holding a workout scheduled after its own race. A second case pins that a goal edit which strands nothing still succeeds, so the new branch is a validator and not a blanket refusal. |
| P4 | §12a `score_plan` never called | `propose_training_plan` with a schedule ramping >15% in one week returns a payload with `quality["ramp_ok"] is False` and `quality["score"] < 1.0` — **and still returns a draft**, which is the advisory-not-a-gate decision made testable. A well-formed ramping-and-tapering schedule returns `quality["score"] == 1.0`. Today the payload has no `quality` key at any input. |
| P5 | §11 dead `notes` parameter | `assemble_brief_context(notes="x")` raises `TypeError`. Today it is accepted and silently ignored — which is the defect: a caller can pass notes and reasonably believe they were read. |

### Contract — the twelve descriptions

One parametrized test over `DESCRIPTION_CONTRACT`, each entry two-sided. Named
individually because a reader has to be able to map a red test to an issue line:

| # | Issue item | Required clause in `description` | Forbidden clause |
|---|---|---|---|
| P6 | §B.1 trend pointer | `get_metric_trend` named as the trend-statistics tool | `trend-related` (the clause pointing at `BriefContext.trends`) |
| P7 | §B.2 `slope_per_day` misnamed | `per observation` | — |
| P8 | §B.3 effect size invisible | `cohens_d` **and** `magnitude` | — |
| P9 | §B.6 correlate floor / window | `5` pair floor **and** `n_pairs` exceeding `days` | — |
| P10 | §B.7 `n_workouts_matched` | `n_skipped_no_baseline` named beside it | — |
| P11 | §B.10 sync cap | `30` and that the CLI has no cap | — |
| P12 | §12c cannot move a day | that it re-prescribes an existing day only | `swap days` |
| P13 | §12d floor is the data frontier | `last_known_daily_date` / "data frontier" | — |
| P14 | §B.4 + §B.9 (after wt-2) | `source` and the `days` bound named | — |
| P15 | §B.8 won't-fix, recorded | `find_anomalies` / `recovery_pattern` still default `lookback_days=0` — pinned as the *deliberate* asymmetry against P1 | — |

Anti-vacuity, without which the table above is decorative:

- **P16** — every key in `DESCRIPTION_CONTRACT` resolves to a name in
  `ALL_TOOLS ∪ LOCAL_ONLY_TOOLS`. A typo'd key pins nothing and would pass
  forever.
- **P17** — the table covers at least the ten tools this issue touched
  (floor constant). Deleting an entry to make a red test green fails P17
  instead, so weakening the gate is never the quiet path.

`tsb_zone`'s docstring correction (§B.5) is deliberately **not** given a test —
it asserts the *absence* of a code path, and the honest evidence is investigate's
measured `SELECT COUNT(*) … ctl IS NOT NULL AND tsb IS NULL` → 0 against the live
1 599-row DB, cited in the docstring itself. Stated here so the omission is a
decision rather than a gap.

### Suite-level

- `uv run pytest -x` green, including the **85% coverage gate**; `ruff` clean
  under the explicit `E4,E7,E9,F,I,UP,B,A` ruleset; the perf-benchmark job
  unaffected (no hot path is touched).
- Existing description assertions that will move and must be updated rather than
  deleted: `tests/test_tools.py:131,136` (the shared snapshot description),
  `tests/test_tools.py:3204,3209-3210,4713`, `tests/test_plan_tools.py:548,552`.
- Per CLAUDE.md, work lands on `dev` and the container is rebuilt from a `dev`
  checkout; promotion to `main` and the version tag happen only when Nate asks.

---

## Work items

Four. Each is reviewable and mergeable alone, and item 1 is deliberately first:
it is the largest diff and the only one with zero behaviour change, and it
installs the gate that items 2 and 3 then have to satisfy. Landing them as one
PR would mix eight string edits with three changes to the plan write path, so a
revert of the risky part is a revert of all of it.

- `descriptions`: the eight description-string rewrites, the `interpret.tsb_zone` docstring correction, the `docs/mcp/` pages reconciled where they now disagree, and the two-sided `DESCRIPTION_CONTRACT` gate in `tests/test_docs_drift.py`. No handler changes.
- `query-workouts-honesty`: `source` added to the SELECT; `days=0` becomes an error instead of an unbounded scan; `min_duration_min=0` honoured; description, `docs/mcp/query_workouts.md` and the contract table updated together, with the `lookback_days=0` won't-fix pinned alongside so the asymmetry is recorded.
- `plan-tool-truth`: `revise_training_plan` revalidates goal-field-only edits against the plan's stored workouts; `plans.score_plan` wired into `propose_training_plan` as an advisory `quality` block; both descriptions and pages corrected.
- `dead-notes-param`: the unread `notes` parameter removed from `assemble_brief_context`, with a test that passing it now raises. Carries the #133 close-out comment enumerating already-fixed / fixed-here / won't-fix, since the issue's own triage line is now wrong and would send the next reader to re-fix 0.38.1.
