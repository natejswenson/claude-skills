# issueflow brief — Investigate

You are the **investigate** stage of an issueflow run on `natejswenson/local-fitness` issue #133.

You are running cold: you cannot see the conversation that dispatched you, and
nothing you were not handed here exists for you. Everything you need is below or
named by a path below.

## The issue — #133

**MCP audit: tool descriptions promise behavior the handlers don't deliver**

<https://github.com/natejswenson/local-fitness/issues/133>

Collected while writing `docs/mcp/`. Each item is a real gap between what a tool's description tells the model and what its handler does. Grouped here for triage rather than filed separately — none is as sharp as #131 or #132, but several will mislead the agent.

Everything below is already documented as a gotcha in the relevant `docs/mcp/` page, so readers aren't surprised before any of it is fixed.

---

## Promises the handler cannot keep

**`get_brief_context` advertises "recent-brief continuity" — it is always empty over MCP.** The handler calls `brief_planner.assemble_brief_context()` with no arguments, so `recent_briefs` is `None` and `continuity` is always `[]`. Only the in-process V2 composer ever populates it. The description sells a feature the tool structurally cannot return.

**`get_today_status` / `daily_snapshot` say "use `get_brief_context` for anything plan-/trend-related."** True for plan, misleading for trend: `BriefContext.trends` is just the `rhr` / `sleep_score` / `steps` / `body_battery_max` entries of `snapshot` re-emitted verbatim — no slope, no direction, no arrow. The 7-day arrows live in the snapshot tools themselves; real trend statistics are in `get_metric_trend`.

## Misleading field names and omissions

**`get_metric_trend.slope_per_day` is misnamed.** The regression x-axis is the sample index over the null-filtered series, so on a gappy metric one step is more than a calendar day. The code comment already acknowledges this ("slope is per-observation, not per-day"); the field name doesn't. Either rename it or document the caveat in the description — a model reading `slope_per_day` will multiply it by days.

**`compare_periods`' description never mentions `cohens_d` / `magnitude` / `delta_pct`.** It says only "Returns mean, SD, count for each + delta". The effect-size read is the most useful part of the payload and is invisible from the description, so the model won't know to ask for it.

**`query_workouts` doesn't return the `source` column**, so manually-logged rows are indistinguishable from Garmin rows except by their negative `activity_id`. Neither the description nor the schema hints at this.

**`training_load_status`'s TSB bands omit a reachable fifth outcome.** Rows are filtered on `ctl IS NOT NULL`, not `tsb`, so `tsb_zone` can return the sentence `"no training-load data yet"` rather than a zone label. `interpret.tsb_zone`'s own docstring flags this as reachable here.

**`correlate` doesn't document its hard 5-pair floor** (`n < 5` → `insufficient paired data`), nor that the SQL cutoff is widened to `days + |lag| + 1` without re-restricting the pairing — so `n_pairs` can legitimately exceed `days`.

**`recovery_pattern.n_workouts_matched` silently excludes** any workout whose own date lacks a `baselines` row with a non-NULL `body_battery_max_60day_mean`. The description reads as if it's the filter match count.

## Input handling

**`find_anomalies.sd_threshold` is neither bounds-checked nor falsy-safe.** `0` silently becomes `2.0` (the default), and a negative threshold returns the entire window. Nothing in the schema suggests either.

**Several tools silently treat falsy numerics as absent** — `days=0`, `limit=0`, `min_distance_km=0`, `lookback_days=0` all fall back to defaults, contradicting the schemas' implication that they're ordinary integers.

**`sync_garmin_data`'s recompute gate is stricter than advertised.** The description says it recomputes "if new data landed"; the handler requires `status == "success"` **and** `days_pulled > 0`. A `partial` run — any remaining gap back to 2020-09-01, or any single failed day — writes activity rows but skips the baseline/CTL recompute. **On a DB that was never fully backfilled, `gap_days_remaining` is permanently non-zero, so `success` may never occur and training load would silently never refresh via this tool.** This one is arguably a bug rather than a doc gap.

Also undocumented on that tool: `SYNC_MAX_DAYS = 30`, and that `fitness pull` (CLI) passes no `max_days` — so the CLI and the tool behave materially differently after a long absence.

## Dead code

`brief_planner.assemble_brief_context()` accepts a `notes: str | None` parameter its body never reads. No tool-surface impact.

---

## Suggested triage

The `sync_garmin_data` recompute gate and the `get_brief_context` continuity promise are the two worth fixing rather than just documenting — both are silent no-ops in the current code.

### Comments (1)

**natejswenson:**

## Additional findings — training-plan tools

From the same audit pass. Three of these look like real bugs rather than doc drift.

### Likely bugs

**`update_plan_workout` silently drops `duration_min` from its response.** The handler writes `target_duration_sec` correctly, but returns `_augment_workout({date, type, distance_meters, avg_pace_sec_per_km, description})` — no duration key, so `_augment_workout`'s `duration_formatted` branch never fires (`agent/tools.py:1769`). A caller setting a tempo duration gets back a payload with no evidence the write landed, which reads as a failed write.

**`plans.score_plan` is dead code from the tool's perspective.** The ramp (≤15%/week) + taper quality gate exists and is unit-tested, but nothing calls it from `propose_training_plan` — no gate runs on plan structure at propose time. The tool description's "Ground it first" implies a rigor the code doesn't enforce. Either wire it in or stop implying it.

**`revise_training_plan` skips revalidation on goal-field-only edits.** Validation runs only when `workouts` is passed, so moving `race_date` earlier can leave workouts dated *after* the race with no error.

### Contract gaps

**`update_plan_workout` cannot move or add a day.** `date` is the `UPDATE`'s `WHERE` key and is outside `_EDITABLE_WORKOUT_COLS`, and `rowcount == 0` errors rather than inserting. Moving a long run is two calls (rest the old day, prescribe the new) and only works if the target day already exists on the plan. Neither the tool description nor CLAUDE.md said so — CLAUDE.md is fixed in this PR; the tool description still implies otherwise ("move a long run, swap days").

**`propose_training_plan`'s date floor is the data frontier, not today.** `created_floor = db.last_known_daily_date() or date.today()`, and `validate_plan_input` rejects any workout outside `[created_floor, race_date]`. With a stale sync the floor sits behind today, which changes what validates — undocumented.

All are documented as gotchas in the corresponding `docs/mcp/` pages.


## Your task

Reproduce or locate the behaviour the issue describes. Name the files and
functions responsible, with `path:line` references a reader can click.
State the root cause in one sentence.
State explicitly whether the issue as written asks for the right fix, and
if it does not, say what the reporter probably wants instead.
List what you could NOT determine. An unknown named is worth more than a
guess presented as a finding.

## You must not

Do not change a single file. This stage reads and reports; an investigation that edited the codebase has destroyed the evidence it was sent to gather.

## Working context

| Field | Value |
|---|---|
| work in | <REPO> |
| repository | <REPO> |
| branch | (no branch yet — this stage does not commit) |
| base branch | main |
| work item | the whole issue |

## Deliver

Write your answer to `<RUN>/shared/investigate.md`.

It must contain a section for each of: **Root cause**, **Evidence**, **Unknowns**. The gate
reads for those names and refuses the stage without them.

Return only the path you wrote and a two-line summary. Your prose is not the
deliverable; the file is.
