# Investigate — natejswenson/local-fitness #133

**MCP audit: tool descriptions promise behavior the handlers don't deliver**

Repo: `/Users/natejswenson/localrepo/local-fitness` · branch `dev` @ `d4938fb` (0.43.0) · working tree clean · nothing modified.

Issue filed **2026-07-22**. Investigated **2026-08-02**.

---

## Root cause

The issue is a list of ~18 independent description-vs-handler mismatches, not one defect — and **roughly a third of it is already fixed**: releases 0.32.0 (2026-07-25) and 0.38.1 (2026-07-26) landed the fixes for six items *incidentally*, as part of a separate audit pass that never cited #133, so the issue was never updated or closed. The remaining twelve items share one real root cause: **`docs/mcp/` was treated as the fix.** Every open item is already written up as a gotcha in the human-facing `docs/mcp/<tool>.md` page, but the *tool `description=` string the model actually reads* was left unchanged — and `docs/mcp/` is not in any model's context. The audit documented the gap for readers and left it open for the agent.

---

## Evidence

### A. Already fixed — do not re-fix (6 items)

The handlers cited in the issue no longer look like the issue says they do. Each fix carries a code comment describing exactly the defect the issue reports.

| Issue claim | Reality now | Where | Landed |
|---|---|---|---|
| `get_brief_context` calls `assemble_brief_context()` with no args ⇒ `continuity` always `[]` | Handler now passes `recent_briefs=briefs.load_recent_briefs()` | [`tools.py:3175-3184`](src/local_fitness/agent/tools.py#L3175-L3184) (comment at 3179-3182 restates the bug verbatim) | 0.38.1 (`31b13f0`) |
| `sync_garmin_data` recompute gate requires `status == "success"` **and** `days_pulled > 0` | Gate is now `recomputed = bool(days_pulled or activities_loaded)` — status-independent | [`tools.py:1268-1274`](src/local_fitness/agent/tools.py#L1268-L1274); `partial` deliberately excluded from `_SYNC_FAILURE_STATUSES` at [`tools.py:1197-1204`](src/local_fitness/agent/tools.py#L1197-L1204) | 0.38.1 (`31b13f0`) |
| `find_anomalies.sd_threshold` not bounds-checked, `0` silently becomes `2.0`, negatives return everything | Only `None` defaults; explicit `0` errors; bounded to `[0.5, 10]` | [`tools.py:1139-1149`](src/local_fitness/agent/tools.py#L1139-L1149) | 0.38.1 (`31b13f0`) |
| `limit=0` silently treated as absent | `_validate_limit` errors on anything outside `[1, 500]`; only `None` defaults | [`tools.py:877-888`](src/local_fitness/agent/tools.py#L877-L888), used at `tools.py:928` | 0.38.1 (`31b13f0`) |
| `min_distance_km=0` silently treated as absent | `_min_distance_meters` skips only `None`/`""`; `0` → a real `distance_meters >= 0` predicate | [`tools.py:854-874`](src/local_fitness/agent/tools.py#L854-L874) | 0.38.1 (`31b13f0`) |
| **(comment)** `update_plan_workout` drops `duration_min` from its response | Echo now carries `"duration_seconds": row["target_duration_sec"]`, so `_augment_workout`'s `duration_formatted` branch fires | [`tools.py:2681-2695`](src/local_fitness/agent/tools.py#L2681-L2695) | 0.32.0 (`ad86eaa`) |

Two notes on staleness:
- The comment's `agent/tools.py:1769` anchor now points at `update_user_note`'s return statement. **Every line number in the issue has drifted** — do not trust them.
- `recovery_pattern` is *partly* fixed. The issue says the skip gate is "any workout whose date lacks a non-NULL `body_battery_max_60day_mean`". That single-channel gate is gone: a workout is now dropped only when **both** the bb and rhr baselines are missing ([`tools.py:1543-1550`](src/local_fitness/agent/tools.py#L1543-L1550)), and the description now says "…and how many were skipped for want of a baseline". What remains true is the narrow point that `n_workouts_matched = len(results)` ([`tools.py:1592`](src/local_fitness/agent/tools.py#L1592)) is still the post-baseline count, not the filter-match count — but `n_skipped_no_baseline` now sits beside it, so the payload is no longer misleading on its own.

### B. Still open (12 items) — every one is a *description* string, not a handler

**1. `get_today_status` / `daily_snapshot` point at `get_brief_context` for "trend".** The shared description ends "use get_brief_context for the full read or anything plan-/trend-related" — [`tools.py:296-304`](src/local_fitness/agent/tools.py#L296-L304). `BriefContext.trends` is a verbatim re-emission of four `snapshot` entries with no slope/direction/arrow: [`brief_planner.py:820-822`](src/local_fitness/agent/brief_planner.py#L820-L822). The real 7-day arrows are `_slope_arrow` in [`status.py:72-83`](src/local_fitness/agent/status.py#L72-L83), i.e. inside the snapshot tools themselves. Confirmed. Documented at `docs/mcp/get_brief_context.md` ("**`trends` carries no trend.**").

**2. `get_metric_trend.slope_per_day` is misnamed.** Payload key at [`tools.py:472`](src/local_fitness/agent/tools.py#L472); the x-axis is `xs = list(range(n))` over the null-filtered series, and the code comment already says "slope is per-observation, not per-day" — [`tools.py:454-463`](src/local_fitness/agent/tools.py#L454-L463). Description ([`tools.py:403-410`](src/local_fitness/agent/tools.py#L403-L410)) says nothing.
*Reproduced:* `get_metric_trend(metric="vo2_max", days=30)` → `{"days_window": 30, "n_samples": 3, "slope_per_day": 0.0}`. Three samples across a 30-day window: one "day" of slope is ~10 calendar days.

**3. `compare_periods`' description omits `cohens_d` / `magnitude` / `delta_pct`.** Description says only "Returns mean, SD, count for each + delta" — [`tools.py:1031-1044`](src/local_fitness/agent/tools.py#L1031-L1044). Payload carries all three — [`tools.py:1094-1103`](src/local_fitness/agent/tools.py#L1094-L1103). (`delta_pct` *is* mentioned, but only inside the `distance_meters` SUM-branch sentence, which is the branch that has no `cohens_d`.) Confirmed.

**4. `query_workouts` does not return `source`.** SELECT list at [`tools.py:936-939`](src/local_fitness/agent/tools.py#L936-L939) omits it, though `source` is declared queryable in `QUERYABLE_SCHEMA` at [`tools.py:99`](src/local_fitness/agent/tools.py#L99).
*Reproduced:* payload keys are `activity_id, activity_name, activity_type, aerobic_te, anaerobic_te, avg_hr, avg_pace_sec_per_km, date, distance_meters, distance_mi, duration_formatted, duration_seconds, effort, elevation_gain_meters, max_hr, pace_min_per_mi, training_load` — no `source`. A manual row is distinguishable only by its negative `activity_id`.

**5. `training_load_status`' fifth TSB outcome — structurally reachable, empirically not.** The SQL filters `ctl IS NOT NULL` ([`tools.py:1306-1310`](src/local_fitness/agent/tools.py#L1306-L1310)) and then calls `interpret.tsb_zone(current.get("tsb"))` ([`tools.py:1344`](src/local_fitness/agent/tools.py#L1344)), which returns the sentence `"no training-load data yet"` on `None` ([`interpret.py:84-85`](src/local_fitness/agent/interpret.py#L84-L85), whose docstring asserts "reachable on `training_load_status`"). **But I could not produce such a row.** The only writer of `baselines` is `INSERT OR REPLACE` in `ingest/baselines.py:42`, and it writes the triple together — `load_by_date[d] = (ctl, atl, ctl - atl)` ([`baselines.py:171-173`](src/local_fitness/ingest/baselines.py#L171-L173), unpacked at `baselines.py:135`) — so `tsb` is NULL exactly when `ctl` is. *Empirical check against the real 1 599-row `data/fitness.db`: `SELECT COUNT(*) FROM baselines WHERE ctl IS NOT NULL AND tsb IS NULL` → **0**.* The issue (and `interpret.py`'s own docstring) overstate this: the filter is loose, but no code path fills the gap.

**6. `correlate`'s hard 5-pair floor and widened window are undocumented.** Floor at [`tools.py:1432-1433`](src/local_fitness/agent/tools.py#L1432-L1433); cutoff widened to `days + abs(lag) + 1` at [`tools.py:1414`](src/local_fitness/agent/tools.py#L1414) with no re-restriction of the pairing loop ([`tools.py:1421-1431`](src/local_fitness/agent/tools.py#L1421-L1431)). Description ([`tools.py:1396`](src/local_fitness/agent/tools.py#L1396)) is one sentence and mentions neither.
*Reproduced:* `correlate(sleep_seconds, rhr, days=30, lag_days=7)` → `{"days": 30, "lag_days": 7, "n_pairs": 32}`. `n_pairs` exceeds `days`.

**7. `recovery_pattern.n_workouts_matched`** — see the note in section A. Narrow claim still holds ([`tools.py:1592`](src/local_fitness/agent/tools.py#L1592)); the misleading framing does not.

**8. `lookback_days=0` still silently defaults.** `args.get("lookback_days") or 90` at [`tools.py:1135`](src/local_fitness/agent/tools.py#L1135) (`find_anomalies`) and `or 365` at [`tools.py:1484`](src/local_fitness/agent/tools.py#L1484) (`recovery_pattern`). Same pattern in `plan_chart`: `args.get("days") or 14` at [`tools.py:793`](src/local_fitness/agent/tools.py#L793).
*Reproduced:* `find_anomalies(metric="rhr", lookback_days=0)` → payload echoes `"lookback_days": 90`.
This is **deliberately** left alone and documented as such — `docs/mcp/find_anomalies.md`: "**`lookback_days: 0` still falls back to 90.** That falsy-fallback was left alone; only `sd_threshold` changed."

**9. `days=0` on `query_workouts` is worse than "falls back to a default" — it removes the filter.** `if args.get("days"):` at [`tools.py:908`](src/local_fitness/agent/tools.py#L908) skips the whole `date >= ?` predicate.
*Reproduced:* `query_workouts(days=0, limit=500)` → 500 rows, oldest **2023-07-06**, `truncated: true` (i.e. the entire activities table, row-capped). `query_workouts(days=1, limit=500)` → 1 row, `2026-08-02`. A model asking for "today's workouts" with `days=0` gets three years of history.

**10. `SYNC_MAX_DAYS = 30` is absent from `sync_garmin_data`'s description**, and the CLI differs. Constant at [`tools.py:66`](src/local_fitness/agent/tools.py#L66), applied at [`tools.py:1266`](src/local_fitness/agent/tools.py#L1266) (`pull(max_days=SYNC_MAX_DAYS)`); the description ([`tools.py:1248-1256`](src/local_fitness/agent/tools.py#L1248-L1256)) never mentions a cap. `fitness pull` passes no `max_days` — [`cli.py:109-114`](src/local_fitness/cli.py#L109-L114) — and `daily.pull` defers the overflow as `deferred_count` ([`ingest/daily.py:601-603`](src/local_fitness/ingest/daily.py#L601-L603)). Confirmed; documented in `docs/mcp/sync_garmin_data.md`.

**11. Dead `notes` parameter.** `assemble_brief_context(db_path=None, *, today=None, notes: str | None = None, recent_briefs=None)` — [`brief_planner.py:757-759`](src/local_fitness/agent/brief_planner.py#L757-L759). The body (757-833) never reads `notes`. Confirmed. No tool-surface impact, as the issue says.

**12. Three plan-tool items from the comment, all still open:**
- **`plans.score_plan` is never called from `propose_training_plan`.** Defined at [`plans.py:558`](src/local_fitness/plans.py#L558); repo-wide the only callers are `tests/test_plans.py:411-427`. `propose_training_plan` ([`tools.py:2491-2517`](src/local_fitness/agent/tools.py#L2491-L2517)) calls `validate_plan_input` and nothing else. Its description still says "Ground it first" ([`tools.py:2483-2488`](src/local_fitness/agent/tools.py#L2483-L2488)). Already a documented gotcha in `docs/mcp/propose_training_plan.md`.
- **`revise_training_plan` skips revalidation on goal-field-only edits.** `if workouts is not None:` gates the whole validation block — [`tools.py:2545-2558`](src/local_fitness/agent/tools.py#L2545-L2558). Moving `race_date` earlier without resending `workouts` leaves workouts dated after the race.
- **`update_plan_workout` cannot move or add a day.** `date` is the `UPDATE`'s `WHERE` key and is outside `_EDITABLE_WORKOUT_COLS` ([`plans.py:612-615`](src/local_fitness/plans.py#L612-L615)); `rowcount == 0` raises rather than inserting ([`plans.py:734-741`](src/local_fitness/plans.py#L734-L741)). The tool description still says "use it to move a long run, swap days" — [`tools.py:2597-2599`](src/local_fitness/agent/tools.py#L2597-L2599). CLAUDE.md was fixed (CHANGELOG 0.26.0 §"Fixed (documentation-adjacent)"); the description was not.
- **`propose_training_plan`'s floor is the data frontier.** `created_floor = db.last_known_daily_date() or date.today().isoformat()` ([`tools.py:2499`](src/local_fitness/agent/tools.py#L2499)) feeds `validate_plan_input`, which rejects `wdate < created or wdate > race` ([`plans.py:286-287`](src/local_fitness/plans.py#L286-L287)). Undocumented in the description.

### C. Is the issue asking for the right fix?

**No, not as written — but the underlying complaint is right and still live.**

Three corrections the implementer needs:

1. **Its own triage line is now wrong.** The issue says "the `sync_garmin_data` recompute gate and the `get_brief_context` continuity promise are the two worth fixing rather than just documenting — both are silent no-ops in the current code." **Both were fixed in 0.38.1.** Anyone starting from the triage advice would re-fix already-fixed code and, in `sync_garmin_data`'s case, risk *reintroducing* the `status == "success"` gate that the current comment explicitly warns against.

2. **What survives is not a code problem, it's a description problem.** All twelve open items are text inside a `@tool(name, description, schema)` call. `docs/mcp/` — added in 0.26.0, the same audit that filed this issue — already documents every one of them as a gotcha, verified page by page. But `docs/mcp/` is a human reference. The model sees only the `description=` string. **The reporter probably wants the description strings brought up to what `docs/mcp/` already says**, not a second round of documentation.

3. **Two items should be closed as won't-fix rather than fixed:**
   - The falsy-`lookback_days` fallback is a *deliberate* decision already recorded in `docs/mcp/find_anomalies.md` ("That falsy-fallback was left alone").
   - The `training_load_status` TSB fifth outcome is not reachable in practice (§B.5). The right action is a one-line correction to `interpret.tsb_zone`'s docstring, which currently asserts reachability the data contradicts — not a defensive branch in the tool.

The one item that deserves promotion above "description fix" is **§B.9 (`days=0` on `query_workouts` removes the date filter entirely)**. The issue files it under a generic "several tools treat falsy numerics as absent" bullet, which undersells it: this is not a default substitution, it is an unbounded table scan returned to the model as if it answered a bounded question, and it is the one remaining falsy-numeric case that has *no* documented rationale. `_validate_limit`'s existing shape (`None` → default, everything else validated) is the pattern to copy.

---

## Unknowns

- **Whether the maintainer already knows most of this is fixed.** Nothing in the repo closes #133 or references it after `CHANGELOG.md:1202`; the 0.38.1 entries (lines 533, 542, 622-627, 665-666) describe the exact fixes without citing the issue. I could not tell whether the fixes were made *because* of #133 or independently. Worth asking before assuming the issue is simply stale.
- **Whether `git log -S` attribution is precise.** All six 0.38.1 fixes attribute to a single squashed promotion commit `31b13f0`, so I can date them ("after the issue") but cannot see which sub-change or PR introduced each one.
- **Whether `docs/mcp/` should be the source the descriptions are generated from.** `tests/test_docs_drift.py` currently pins page *existence* and availability phrasing, not description text, so nothing today would catch a description drifting back out of sync with its page. I did not evaluate whether that gate is worth building — it is a design question for the next stage, not a finding.
- **Whether `n_pairs > days` in `correlate` is intentional.** The widened cutoff carries a comment explaining *why* it widens (lagged partners at the window edge) but nothing states whether the un-restricted pairing is the intended consequence or an oversight. `docs/mcp/correlate.md` documents it neutrally as behaviour. I did not find a design doc settling it.
- **Whether any `baselines` row could historically have had `ctl` without `tsb`.** I checked only the current `data/fitness.db` (0 rows) and the current writer. A pre-0.22 schema or an abandoned migration could have produced such rows; I did not walk the migration history.
- **The `trends` field's intended contract.** `BriefContext.trends` re-emits snapshot entries verbatim. I could not determine whether the field was meant to carry real trend statistics and was left unfinished, or whether the name is simply wrong for a "these four are the ones to watch" subset.

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
