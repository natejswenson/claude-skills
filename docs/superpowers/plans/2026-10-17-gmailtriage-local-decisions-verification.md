# Local classifier integration verification

## Scope

Implemented an opt-in `suggest-local` adapter in the existing Gmail triage skill.
Codex/Claude retains orchestration and existing rules/plan/apply/receipt authority.
The separately installed encoder returns uncalibrated independent entailment scores;
this is not a Jev implementation or calibrated decision model. No model weights,
Python dependencies or host-specific paths are included in the plugin.

## Observed checks

- Existing baseline:182 Gmail triage tests passed before implementation.
- Final implementation:190 tests passed, including real Node subprocess success/failure,
  offline arguments/environment, request permissions/cleanup, eligibility, policy
  validation, unsafe paths and source/output alias regressions.
- skillfactory verify reached rung3/3:17 wiring checks, house lint, full npm suite,
  and existing reproducible baseline.
- Claude/Codex compatibility, generated metadata, PRESS README target and all26
  skillhelp index cards passed. Skillhelp's18 regression tests passed.
- npm install/audit found zero vulnerabilities; no dependency changes introduced.
- Independent task review found an output-alias overwrite bug. A test reproduced
  it, the fix added unused-output/canonical-input guards and exclusive writes, and
  scoped re-review approved compliance and quality.

## Real local model smoke

Ran the actual configured Python classifier with offline loading, using23 invented
threads and explicit invented label descriptions in a scratch directory outside Git.
Existing proposal guards yielded exactly2 eligible senders. The adapter returned2
existing-label suggestions; already-claimed, sensitive whole-cluster, deterministic
label match, personal, self-sent and ambiguous senders did not cross the boundary.
All five source/config file hashes remained unchanged, no planted snippet appeared
in output, and the command cleaned its private request directory. Repeating with
an occupied output path failed and preserved both inputs and the prior result.

This verifies integration mechanics, not general mailbox accuracy or calibration.
The earlier20-case classifier baseline had only20% suggestion coverage. Thresholds
remain fixed provisional heuristics; users review advice before accepting rules.
The timeout test checks90-second/SIGKILL settings and simulates timeout instead of
waiting90seconds. Offline flags constrain the supported loader; they do not sandbox
arbitrary user-configured executables.

## Delivery boundary

No Gmail tools were called and no real mailbox data was fetched. Runner configuration
and development-plugin installation are local setup, separate from these source
commits. A new Codex session may be needed to load updated skill instructions.
Feature delivery uses a draft PR; merge, release and mailbox actions remain separate.
