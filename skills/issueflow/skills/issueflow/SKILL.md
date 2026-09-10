---
name: issueflow
description: Take one GitHub issue through an independently reviewed plan, implementation, draft pull request, and converging review loop. Use when the user says "work an issue", "fix issue 42", "take this issue to a PR", or asks to list open issues. Runs autonomously by default; use --review-plan only when a human plan gate is explicitly requested.
user_invocable: true
version: 0.11.1
---

## Runtime

Resolve bundled paths beside this `SKILL.md`; pass the repository with `--repo`.
`~/.claude/issueflow` remains canonical for both hosts.

In Codex, invoke `$issueflow` with `--runtime codex`. Dispatch each printed
subagent with its exact model, reasoning, role, and prompt; completion returns
automatically.

Request one reusable approval for the absolute CLI prefix when sandbox
escalation is needed; never imply host prompts can be bypassed.

**Announce once:** "I'm using the issueflow skill — plan, red team, implement,
then a review loop on the pull request."

## Run contract

**No stage runs on anything but its predecessor's artifact, approved and written
to disk — and a stage that was skipped is reported as skipped, never as done.**
The CLI enforces this rule; the orchestrator never performs stage work or edits
an artifact to clear a gate.

Autoflow is autonomous. A registered, hash-bound red-team pass approves the
plan; `next` continues. `--review-plan` opts into one human gate. Routine edits,
transitions, retries, fixes and readiness need no confirmation.

User decisions are required for destructive takeover, unresolved drift,
exhaustion, repeated disputes, missing authority or unauthorized external
actions. Auto mode never forces drift, takes over claims, rules findings or
merges without authorization.

## Start or resume

From `$SKILL_DIR`:

```bash
node "$SKILL_DIR/scripts/issueflow.js" board --repo <path>
node "$SKILL_DIR/scripts/issueflow.js" start --repo <path> --issue <n> --runtime codex
node "$SKILL_DIR/scripts/issueflow.js" next --run-dir <run>
```

After explicit user direction to extend an expired budget:

```bash
node "$SKILL_DIR/scripts/issueflow.js" resume --run-dir <run> --budget-seconds 1800
```

Never auto-renew. This grants time from resume; review limits stay unchanged.
It preserves artifacts, commits, gates, runtime and checkpoint identity, and
dispatches nothing. Follow its printed `next` command.

Run `board` only without a named issue. Ask which issue; never ask about anything
in it because policy and claims are facts. Continue a live run named by `board`.
Never call `gh issue view` after `start`; the frozen issue is authoritative.

`start` is autonomous unless `--review-plan` is present. Pass `--take-over`
only after a human has read the displaced claim and explicitly accepted its
destructive cost. Auto mode never takes over.

## Drive `next`

After `start`, run `next` repeatedly. It performs deterministic work and prints
exactly one dispatch, wait, or stop.

- **Dispatch:** Spawn exactly the printed subagents with exactly the printed
  prompt/model/reasoning/role. Dispatch independent agents immediately. Never
  do the stage yourself.
- **Wait:** The artifact on disk is the state-machine signal. In Claude or a
  host without native agent waiting, yield the exact printed `wait:` command,
  then run `next`. In Codex, wait on dispatched agents with the native
  collaboration wait, then run `next`; the summary is information while `next`
  still validates artifact freshness and completeness. Do not add a second
  20-second shell settle after the agent has completed.
- **Gate refused (exit 2):** `next` has re-rendered the brief. Re-dispatch its
  exact prompt with the printed refusal appended. Never repair the artifact in
  the orchestrator.
- **Infrastructure (exit 3):** Worktree failures stop; never fall back to source.
  Only explicit `--no-worktree` leases it. Otherwise retry; request scoped permission
  when blocked.
- **Stop:** Follow the table below. Never advance over a safety stop by guess.

| Stop | Action |
|---|---|
| `human` | Only with `--review-plan`; present the plan and review, then ask once. |
| `drift` · `take-over` | Show what moved or would be displaced; wait for the user's decision. |
| `exhausted` · `dispute` | Show every open finding and the last fix; only the user may rule it or buy another round. |
| `budget` | Delivered artifacts reach their gates before expiry blocks new dispatches. Report checkpoint results; resume only on explicit direction. |
| `stalled` · `unpushed` | Show the named incomplete work and stop; do not manufacture completion. |
| `shipped` | Report every PR and review URL. The PR is ready; merge only when authorized. |
| `done` | Report verified landings and cleanup. |

The flow is plan → independent red team → automatic plan acceptance →
implementation with observed red-before-green proof → draft PR → independent
finder/verifier/fixer rounds → ready when no major remains and CI is green.
One pull request per issue is the default. Split only when the approved plan contains
genuinely reviewable stacked work items.

Issueflow persists a complexity profile:
plain wording uses `fast-docs` (one review round, 15 minutes); docs mentioning
tests, templates, generated files, manifests, or acceptance criteria use
`standard` (two rounds, 30 minutes); code and operations use `deep`. Resuming
does not change the profile. Elapsed time includes waits; expiry prevents new
dispatches, including a refused gate's send-back. In-flight work may finish.

Review fanout discounts tests and generated indexes; sensitive changes retain
multiple finders. Every file remains in the brief. Candidates determine verifiers.

## Safety invariants

- Every state change is checkpointed. If a checkpoint fails, say the run is
  only local and stop.
- The run persists that choice of runtime. The red team is the gate, and it is
  a dispatched subagent — never you. Never do a stage's work yourself.
- Never dispatch a stage on a model other than the one the brief names.
- Never weaken a review to clear a finding. Classify dispositions honestly;
  repeated blockers stop for a user decision. Never auto-ship over an open
  blocking finding. Never ready a pull request over an open major.
- A round never reviews code GitHub has not received; local, remote, and PR
  heads must agree.
- Never advance over drift you have not shown the user. Auto mode never touches
  `--force`. Auto mode never passes `--take-over`.
- A fixer notes the skip rather than arguing with it; the next verifier rules.
- Never claim a result you did not observe: PR, review, convergence, readiness,
  merge, checkpoint, and test claims come from their corresponding command.
- `finish --close-issue` runs only after every PR merge is observed. It removes
  worktrees and branches and records the run as done.

## Read only when needed

| Situation | Reference |
|---|---|
| Drift, takeover, exhaustion, dispute, checkpoint failure | `references/operator-stops.md` |
| Resume diagnosis or state-machine maintenance | `references/anatomy.md` |
| The plan proposes multiple work items | `references/decomposition.md` |
| Editing briefs, dispatch, completion, or wait behavior | `references/dispatch.md` |
| Editing or diagnosing PR review behavior | `references/review-method.md` |
| Internal commands beyond `board`, `start`, and `next` | `node "$SKILL_DIR/scripts/issueflow.js" --help` |

The CLI and `skill-invariants.json` are the canonical inventories. Do not
duplicate them here.

<!-- press:runtime -->
In Claude Code, load `/press`; in Codex, load `$press`; then follow the shared PRESS terminal/UI contract from `brand/agent-ui.md`. Do not copy or override that contract here.
<!-- press:runtime -->
