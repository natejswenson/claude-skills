# Real CLI compatibility baseline

On 2026-09-21, the external Traefik CLI's `tk capabilities --json` was run against
the maintainer's actual local stack. `evals/capabilities.json` contains that response:
protocol metadata only, with no hostname, checkout path, credential or service data.
The CLI change introducing this response was on `codex/skill-capabilities`, based on
merged main commit `daae36d`. This baseline is evidence of compatibility checking,
not of every service being healthy or either host completing a model-driven session.

The real helper `detect --stack ...` accepted that CLI. Its offline `check` command
then emitted the `compatibility.json` frozen in `evals/baseline/`. The generated
baseline runner repeats the check and byte-compares its output without network,
Docker, model calls or access to the original stack. `evals/incompatible.json` is
the captured response with only `removal-preview-v1` removed; it must fail.

To refresh, collect a fresh capability response from a trusted external CLI, inspect
it for private data, run live detection, regenerate the one-capability trap, and
run `check --input evals/capabilities.json --out <temporary-output>`. Freeze that
actual output with skillfactory, recording what was run. Do not substitute mock
data for the real capture. The exact freeze command is in `skill-invariants.json`; first produce its input
with `node scripts/traefik.js check --input evals/capabilities.json --out
/tmp/traefik-baseline-review` from the skill directory. Replaying an existing
capture does not prove a new live CLI is compatible.
