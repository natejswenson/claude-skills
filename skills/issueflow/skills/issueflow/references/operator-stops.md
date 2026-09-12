# Operator stops

Read this only when `next` stops for a person or reports a failed checkpoint.
The printed stop reason is authoritative; do not infer a different transition.

## Drift

Show the user every changed GitHub fact that `next` reports. Never pass
`--force` before they decide, and never use it in autonomous mode. The work may
already have landed or the reviewed head may no longer be the branch head.

## Takeover

Never pass `--take-over` until the user has read the existing claim. Takeover
replaces that run's issue checkpoint, removes its worktrees, force-deletes local
branches, and can destroy commits that were never pushed. Its artifacts move to
`superseded/<timestamp>/`, but unpushed commits are not recoverable from that
archive. Autonomous mode never takes over.

## Plan exhaustion

Time allowance expiry is a separate `budget` stop; it cannot buy review rounds.

After three blocked red-team rounds, show every remaining critical/high finding
and stop. Never approve or ship over it. The user may change scope or end the
run; do not manufacture another pass.

## Review exhaustion

Round four may land a fixer commit that has not been re-verified. Show the last
fix commit and every open major/thread, not a prose summary. Only the user may:

```bash
node "$SKILL_DIR/scripts/issueflow.js" review-rule --finding <id> --fixed --note "<what they checked>" --run-dir <run>
node "$SKILL_DIR/scripts/issueflow.js" review-rule --finding <id> --withdrawn --note "<why>" --run-dir <run>
node "$SKILL_DIR/scripts/issueflow.js" review-brief --another-round "<why>" --lane <lane> --run-dir <run>
```

The orchestrator never runs those commands on its own judgment.

## Dispute

A fixer may report `not-changed` once with a reason. The next verifier rules.
If a major survives as a repeated dispute, show the thread and stop for the
user; do not weaken or reclassify it to converge.

## Stalled or unpushed

For a stalled stage, re-dispatch only the exact brief `next` prints. For an
unpushed fix, show the named local/remote head mismatch and stop. A review round
never examines code GitHub has not received.

## Checkpoint failure

A local state transition may have succeeded even when its GitHub checkpoint
failed. Say plainly that the run is not backed up and stop. Retry the checkpoint
through the same Issueflow command; never recreate the comment or state by hand.

## Budget expiry

`next` processes delivered artifacts through their existing acceptance and
registration gates, even after the deadline. It saves newly observed delivery
metadata and checkpoints before a `budget` stop (exit 4). An unreviewed or
rejected artifact is preserved without approval. A failed checkpoint means
incomplete backup: repair the reported failure and retry `next`; approvals
remain recorded locally. Offline runs save locally and make no network calls.

Budget stops prevent `brief`, `review-brief`, `review-verify`, and
`review-fix-brief`, including `next`'s send-back after a gate refusal. Finder
candidates remain intact when verification cannot yet dispatch. In-flight
workers may finish and their delivered results can still be processed.

In manual mode, only on explicit user direction, run:

```bash
node "$SKILL_DIR/scripts/issueflow.js" resume --run-dir <run> --budget-seconds 1800
```

Autonomous runs renew bounded windows within their original cumulative cap.
Manual runs never auto-renew because `next` printed this command. The positive integer
grants a full allowance from the renewal timestamp, even if the prior deadline
expired hours ago. The original creation time, complexity, artifacts, evidence,
commits, stage approvals, checkpoint identity and runtime remain intact; review
limits stay unchanged. Active or completed runs refuse renewal, as do missing,
boolean, zero, negative, fractional, nonnumeric, nonfinite, unsafe-integer or
unrepresentable allowances. Resume appends a renewal and prints the exact
`next` command; it dispatches nothing. Never edit `run.json` or use takeover as
budget recovery. Fix disputes, review exhaustion and drift through their own
gates; a time renewal does not resolve them.

Dispatch/wait output shows total elapsed time since creation, the current
allowance, remaining seconds and expiry. Native agent completion goes directly
to `next`; the fallback filesystem wait retains its single stability check.

## Missing authority

If GitHub, the filesystem sandbox, or another host boundary requires authority,
request the narrowest reusable permission that covers the Issueflow lifecycle.
Do not split one known lifecycle into repeated per-subcommand asks. A standing
workflow approval never bypasses the host's security controls.
