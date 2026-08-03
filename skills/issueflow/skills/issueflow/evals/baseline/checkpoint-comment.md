<!-- issueflow:run natejswenson/local-fitness#133 -->

### 🤖 issueflow — natejswenson/local-fitness#133

Each stage below ran as its own subagent and was approved by a human before
the next one started. This comment is rewritten at every gate.

| Step | Model | State | Took |
|---|---|---|---|
| investigate | opus | ✅ approved | — |
| design | opus | ✅ approved | — |
| root/implement | sonnet | briefed | — |
| root/test | sonnet | pending | — |

| Lane | Branch | Base | Pushed |
|---|---|---|---|
| root | `feature/issue-133` | `main` | — |

---

<details><summary><b>investigate</b> — investigate.md</summary>

# Investigation — natejswenson/local-fitness #133

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

</details>

<details><summary><b>design</b> — design.md</summary>

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
  `trend-related` — that is the exact clause that se

… truncated at 3417 characters. The whole artifact is at `design.md` in the run directory.

</details>

_Remaining artifacts omitted — the comment reached its size budget._
