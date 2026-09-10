# dispatch — the prompt is the only channel

A subagent starts cold. It cannot see the conversation that dispatched it, the
files the orchestrator read, or any decision already made. Whatever is not in
its brief does not exist for it.

That makes the dispatch prompt the highest-variance part of a multi-agent run —
and, when it is improvised in the moment, the only part nobody reviews, because
it never lands on disk.

**So it lands on disk.** Every brief — a stage's, the red team's, a finder's, a
verifier's, the fixer's — is rendered from the run state and the approved
artifacts, written under `briefs/`, and handed back as a path. The baseline
eval byte-compares those files, which is how a brief that silently stopped
carrying the plan gets caught by CI instead of by a confused subagent.

Before implementation dispatch, the CLI validates or provisions the lane checkout.
A failure exits 3 without a new brief or briefed transition. Never substitute the
live checkout. Explicit `--no-worktree` is a persistent source-mode lease, accepted
at start or first implementation dispatch; it refuses overlapping writable lanes.
Rebriefs, acceptance and review workers validate the same recorded checkout.

## What crosses

For Codex, the parent must supply `--workspace-root <approved-root>` at preparation
and ensure each child inherits that actual writable root. Merely changing cwd or
printing an additional directory grants no permission. Prefer a writable workspace
or temporary root outside the user's live checkout. Both output paths and the
lane's complete Git administration live there. Only explicit `--no-worktree`
uses the source lease, and that opt-out may still require Git metadata authority.

Investigators, plan reviewers, implementers, finders, verifiers and fixers all
receive prepared output/progress directories. Briefs name a prepared `TMPDIR`;
set it in every child subprocess environment, particularly when the host excludes
global temporary directories. Children write declared outputs and finish their
turn; the parent imports exact bytes and timestamps and persists canonical state.
A failed import stops the successor dispatch with the local recovery path.

Preparation is available directly for legacy runs:
`node "$SKILL_DIR/scripts/issueflow.js" prepare --run-dir "<run>" --workspace-root "<approved-root>"`.
Resume retains the recorded root and generation. Restore dirty/in-flight legacy
work before migrating. Rebrief requires a fresh result; copying the previous
delivery with a new mtime cannot satisfy the new dispatch. Old approved Markdown
and hashes remain unchanged. See anatomy for archival and missing-staging recovery.

| In the brief | Why |
|---|---|
| who the subagent is, and that it is cold | it will otherwise assume shared context and ask questions nobody hears |
| the issue body and every comment, inlined | the ground truth, and the fix is often in the comments |
| the paths of every approved prior artifact | the decisions it inherits, with an instruction to read them first |
| the exact task, from the stage declaration or the method file | so two runs of the same stage are asked the same thing |
| what it must not do | every stage has one characteristic overreach |
| the branch, the base and the work item | it commits; it needs to know where |
| the artifact path and the sections the gate reads for | a stage that writes the wrong file has done nothing |
| for a review-loop brief: the diff file, the head, the checkout, and the findings already open by id | a reviewer reads the change, not the pull request page; a finder hunts gaps, not repeats |
| how to report completion | Claude sends `main` a `SendMessage`; Codex finishes its subagent turn and returns the summary to the parent automatically |
| the runtime's model, reasoning and role | the dispatch must map to fields the host actually supports, and a run may not switch profiles halfway through |

## What never crosses

- **The conversation.** If it mattered, it belongs in an artifact.
- **The orchestrator's opinion of the previous stage.** The artifact was
  approved; a commentary layer on top of it is a second, unreviewed source of
  truth.
- **Anything about the other lanes.** A work item that needs a sibling's context
  was not a separable work item, and the split was wrong.

## Why paths, not pasted text

Prior artifacts cross as paths with a mandatory "read these first" instruction,
not as inlined copies. A brief that copies its predecessor's prose creates a
second copy that drifts from the file the user actually approved. The subagent
can open a file; the file stays the single source.

The same reasoning governs how the brief itself reaches the subagent. The
dispatch prompt is one line:

```
Read <briefs/investigate.md> and follow it exactly. It is your complete brief.
```

Pasting the brief into the transcript would put a page of machine-generated
instructions in front of a user who has no reason to read it, and would make the
prompt something the orchestrator retyped rather than something the renderer
produced.

## Why the wait is a file, not a message

Going idle is not a signal. Across a real two-run corpus, ten stage subagents
ran and only four sent the orchestrator anything on completion; the other six
went idle with a content-free notification, indistinguishable from a stalled
agent. The brief still closes with a host-specific instruction — Claude sends
`main` the output path and a short result, while Codex finishes with that
summary and returns it to the parent automatically. With native agent waiting,
completion means run next immediately; no second shell settle is needed.
`next` still checks artifact freshness and completeness. Hosts without native
completion use the fallback wait line once:

```
sh -c 'end=$(( $(date +%s) + 1800 )); until [ <output> -nt <brief> ]; do [ $(date +%s) -ge $end ] && exit 124; sleep 5; done; <…then until the output's size has held still for 20s>'
```

The fallback requires output *newer than the brief that dispatched it*, then *unchanged in size
for twenty seconds* — a subagent writes its artifact in passes, and the first
real 0.7.0 run briefed the red team on a plan that was 409 of its 823 lines
long. A re-dispatch over an existing artifact does not fire instantly, no sentinel the subagent could
forget is needed, and exit 124 at the deadline is a stall the orchestrator reads
without guessing. The deadline is three times this repo's own median for the
step, else thirty minutes — plain POSIX `sh` and `date +%s`, because GNU
`timeout` is not on a stock Mac, which the first real run of 0.7.0 found
within a second of arming its first wait. The message remains the enrichment: it tells the
orchestrator what happened, not whether it happened.

The wait's stall threshold and the run's time allowance are separate clocks.
Dispatch/wait output shows elapsed, allowance, remaining time and expiry. A
worker already in flight may complete after budget expiry; `next` processes
the result through its normal gate and checkpoint before refusing a successor
dispatch. Only explicit `resume --budget-seconds` grants a new time window.

## The declarations are the contract

`scripts/lib/stages.mjs` holds each stage's semantic declaration, artifact name,
`asks`, `forbids` and `requires`. `scripts/lib/reviews.mjs` holds the red
team's. `scripts/lib/runtime.mjs` resolves those roles to host-native model,
reasoning and agent fields and persists the resolved stage fields in `run.json`.
`references/review-method.md` holds the review loop's angles, the
verifier's contract and the fixer's rule, spliced into those briefs verbatim.
Everything else reads them: the brief renderers, the gate, the run board. A
stage cannot drift between what it is told to do and what it is checked for,
because both come from the same object — and the corpus baseline goes red if
any declaration loses a field, since a state machine missing a stage still
renders as a complete-looking board.
