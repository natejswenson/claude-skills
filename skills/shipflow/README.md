# shipflow

Scaffold a configurable `dev`/`main` branching, auto-merge, branch-cleanup,
and release-tagging workflow into any repo.

Install as a Claude Code skill and run it in the target repo — it detects
existing branch protection, CI checks, and release conventions, shows you a
plan, and only applies it after you confirm. Config and logic are separate:
the skill package is identical across every adopting repo; the actual policy
(`branches`, `requiredChecks`, `release.mode`, ...) lives in the target
repo's own `.github/shipflow.json`, committed and auditable.

All deterministic work runs through the published CLI:

```
npx -y @natjswenson/shipflow@latest <command>
```

**Always pin `@latest`.** Without an explicit version/tag, `npx` can silently
resolve a stale install already on your `PATH` (e.g. a leftover `npm install
-g @natjswenson/shipflow`) instead of fetching the current version from the
registry — with no warning. This isn't hypothetical: it happened during this
skill's own dogfooding, silently running a stale 0.2.0 install that was
missing every fix through 0.2.5, including a Critical security fix. If you've
ever run `npm install -g @natjswenson/shipflow` for manual testing,
`npm uninstall -g @natjswenson/shipflow` to remove the shadow entirely.

See [`skills/shipflow/SKILL.md`](skills/shipflow/SKILL.md) for full usage and
[`docs/plans/2026-07-14-shipflow-skill-design.md`](../../docs/plans/2026-07-14-shipflow-skill-design.md)
for the full design (7 rounds of adversarial review, score 12 → 0).

## Status

**Phase A (current, v0.2.5):** `release.mode: "manual-gate"` + branch cleanup
+ `dev → main` auto-merge — implemented, unit-tested, and live-validated
end-to-end via dogfooding on this repo (`claude-skills`) and an external repo
(`natejswenson/1.00s`). A full Siege security audit (2026-07-15) found and
fixed 8 findings (1 Critical, 1 High, the rest Medium/Low) before rollout;
zero Critical/High findings remain open. See `CHANGELOG.md` for the
fix-by-fix history (0.2.1 → 0.2.5).

**Phase B (not yet implemented):** `release.mode: "auto"` (fully automatic
semantic-release tagging via `release-please`). Accepted in config, refused
at apply time with a clear error until it ships.

## License

MIT
