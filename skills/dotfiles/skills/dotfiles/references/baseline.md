# Real-run baseline

On 2026-09-25, the new helper inspected the reference checkout's working tree
against its real home target, read-only. It observed seven packages and fourteen
correctly linked files. The recorded `evals/inputs/inspection.json` contains only
reviewed package names, relative paths, state counts and policy flags. Absolute
checkout/home paths are omitted by the helper itself. No file bodies, link target
strings, Git identity, credentials, remote URLs or machine-specific settings were
captured. The generic relative package/path names were retained unchanged; no
state was invented or converted to linked during normalization.

`evals/replay.mjs` reconstructs that topology in a fresh temporary home with the
checkout nested under `localrepo/dotfiles`. File bodies are inert placeholders.
It reruns the actual inspect, verify and report CLI commands and checks at least
fourteen files across seven packages. It rejects new states/exclusions/policies
until the maintainer explicitly reviews and implements their replay semantics.
The frozen artifacts pin both classification and Markdown rendering. Separate
filesystem tests exercise missing/conflicting links and hostile layouts; the
real run did not observe those states and is not described as doing so.

`evals/trap.mjs` runs the actual inspector against a traversal package and returns
its status. The baseline must fail if this unsafe input ever succeeds. Snapshot
count/path corruption and source/parent symlinks have separate tests.

## Refresh

Do not refresh merely to make a failure disappear. Inspect the behavioral change.
To replace the source observation, invoke the inspect CLI with explicit authorized
checkout/target paths and `--json`, save it locally, review all metadata for privacy,
and only then replace `evals/inputs/inspection.json`. Never commit raw config data.
Run these commands from the directory containing this SKILL.md, substituting the
loaded skillfactory CLI path and a fresh output directory:

```bash
node evals/replay.mjs /tmp/dotfiles-reviewed-run
node "$SKILLFACTORY_DIR/scripts/skillfactory.js" freeze --repo "$SKILLS_REPO" --skill dotfiles --from /tmp/dotfiles-reviewed-run --command 'node evals/replay.mjs "$OUT"' --trap-command 'node evals/trap.mjs'
npm test
```

The independent local lifecycle check is `node evals/lifecycle.mjs`. It requires
GNU Stow, refuses unreviewed global Stow policy, uses a temporary target, and proves
inspect/edit/add-package/preview/link/idempotency/unlink/per-file recovery while
preserving local overrides and unrelated application files. It ran successfully
on the maintainer's Mac. It is separate from the offline Node-only CI suite and
is not evidence of interactive Claude Code or Codex runtime exercise.
