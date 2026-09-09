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

## Missing authority

If GitHub, the filesystem sandbox, or another host boundary requires authority,
request the narrowest reusable permission that covers the Issueflow lifecycle.
Do not split one known lifecycle into repeated per-subcommand asks. A standing
workflow approval never bypasses the host's security controls.
