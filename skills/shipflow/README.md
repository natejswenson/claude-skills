# shipflow

Scaffold a configurable `dev`/`main` branching, auto-merge, branch-cleanup,
and release-tagging workflow into any repo.

Install as a Claude Code skill and run it in the target repo — it detects
existing branch protection, CI checks, and release conventions, shows you a
plan, and only applies it after you confirm. Config and logic are separate:
the skill package is identical across every adopting repo; the actual policy
(`branches`, `requiredChecks`, `release.mode`, ...) lives in the target
repo's own `.github/shipflow.json`, committed and auditable.

See [`skills/shipflow/SKILL.md`](skills/shipflow/SKILL.md) for usage and
[`docs/plans/2026-07-14-shipflow-skill-design.md`](../../docs/plans/2026-07-14-shipflow-skill-design.md)
for the full design (7 rounds of adversarial review, score 12 → 0).

## Status

**Phase A (current):** `release.mode: "manual-gate"` + branch cleanup +
`dev → main` auto-merge — fully implemented and unit-tested.

**Phase B (not yet implemented):** `release.mode: "auto"` (fully automatic
semantic-release tagging via `release-please`). Accepted in config, refused
at apply time with a clear error until it ships.

## License

MIT
