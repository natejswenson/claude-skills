---
name: issueflow
description: Take one GitHub issue through an independently reviewed plan, implementation, draft pull request, and converging review loop. Use when the user says "work an issue", "fix issue 42", "take this issue to a PR", or asks to list open issues. Runs autonomously by default; use --review-plan only when a human plan gate is explicitly requested.
user_invocable: true
version: 0.11.0
---

## Runtime

Resolve bundled paths from the directory containing this `SKILL.md`; pass the
user's repository separately with `--repo`. Existing `~/.claude/issueflow` run
paths remain canonical for Claude and Codex.

In Codex, invoke this skill as `$issueflow` and pass `--runtime codex` to
`start`. Dispatch every required subagent with Codex's delegation tools using
the exact model, reasoning effort, role, and one-line prompt printed by the CLI.
Do not substitute a model. Codex briefs omit optional progress-file writes;
subagent completion returns to the parent automatically.

On the first lifecycle command that needs sandbox escalation, request one
reusable approval for the absolute `node <SKILL_DIR>/scripts/issueflow.js`
prefix when scoped approvals are supported. Never request one approval per
subcommand, and never imply the skill can bypass a host security prompt.

**Announce once:** "I'm using the issueflow skill — plan, red team, implement,
then a review loop on the pull request."

## Run contract

**No stage runs on anything but its predecessor's artifact, approved and written
to disk — and a stage that was skipped is reported as skipped, never as done.**
The CLI enforces this rule; the orchestrator never performs stage work or edits
an artifact to clear a gate.

Autoflow is autonomous by default. A registered, hash-bound red-team pass
approves the plan and `next` continues without asking. `--review-plan` opts into
one human plan gate. Routine edits, transitions, retries, review fixes, and
readiness do not need conversational confirmation.

Human intervention remains mandatory only when the user must make a real
decision: destructive takeover, unresolved drift requiring `--force`, plan or
review exhaustion, a repeated dispute, missing authority, or an external action
the user did not authorize. Autonomous mode never forces drift, takes over a
claim, rules a finding, or merges a pull request without authorization.

## Start or resume

From `$SKILL_DIR`:

```bash
node "$SKILL_DIR/scripts/issueflow.js" board --repo <path>
node "$SKILL_DIR/scripts/issueflow.js" start --repo <path> --issue <n> --runtime codex
node "$SKILL_DIR/scripts/issueflow.js" next --run-dir <run>
```

Run `board` only when the user did not name an issue. Show its issue table and
ask only which issue; never ask about anything in it because branch policy and
claims are facts, not questions. Resume
a live local run named by `board`. Never call `gh issue view` after `start`; the
frozen issue on disk is authoritative.

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
- **Infrastructure (exit 3):** Retry the same command. If the host blocked a
  required action, request one scoped reusable permission.
- **Stop:** Follow the table below. Never advance over a safety stop by guess.

| Stop | Action |
|---|---|
| `human` | Only with `--review-plan`; present the plan and review, then ask once. |
| `drift` · `take-over` | Show what moved or would be displaced; wait for the user's decision. |
| `exhausted` · `dispute` | Show every open finding and the last fix; only the user may rule it or buy another round. |
| `stalled` · `unpushed` | Show the named incomplete work and stop; do not manufacture completion. |
| `shipped` | Report every PR and review URL. The PR is ready; merge only when authorized. |
| `done` | Report verified landings and cleanup. |

The normal flow is plan → independent red team → automatic plan acceptance →
implementation with observed red-before-green proof → draft PR → independent
finder/verifier/fixer rounds → ready when no major remains and CI is green.
One pull request per issue is the default. Split only when the approved plan contains
genuinely reviewable stacked work items.

Before dispatch, issueflow persists a complexity profile from the frozen issue:
plain wording uses `fast-docs` (one review round, 15 minutes); docs mentioning
tests, templates, generated files, manifests, or acceptance criteria use
`standard` (two rounds, 30 minutes); code and operations use `deep`. Resuming
does not change the profile; expiry hands the run back with its current artifact.

Review fanout is sized by semantic change load: production behavior counts
fully, tests are down-weighted, and generated indexes/baselines do not buy
duplicate finders. Every file remains in the review brief. Sensitive workflow,
security, auth, migration, permission, and manifest changes retain a
multi-finder floor. Verifiers are candidate-driven; zero candidates means zero
verifier calls.

## Safety invariants

- Every state change is checkpointed. If a checkpoint fails, say the run is
  only local and stop.
- The run persists that choice of runtime. The red team is the gate, and it is
  a dispatched subagent — never you. Never do a stage's work yourself.
- Never dispatch a stage on a model other than the one the brief names.
- Never weaken a review to clear a finding. Never auto-ship over an open
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

<!-- press:agent-ui -->

<!-- >>> press:agent-ui v0.9.0 sha256:fd04c30ca97d GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Keep file reads focused.** Scripts hand each other *paths*; when you need
  a file's text in context, use the host's available file-reading capability.
  In Claude Code, prefer `Read`; in Codex, use focused file or shell reads.
  Read only the relevant range and keep raw file contents out of user-facing
  updates. A fetched page or a script's source is usually a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, inspect the
  rendered image with the host's available image-inspection capability.
  In Claude Code, prefer `Read`; in Codex, use `view_image` when available.
  Show the rendered artifact to the user using the host's display or attachment
  capability. If inspection is unavailable, say so; do not claim visual verification.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->
