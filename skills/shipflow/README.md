# shipflow

[![npm](https://img.shields.io/npm/v/@natjswenson/shipflow?color=blue)](https://www.npmjs.com/package/@natjswenson/shipflow)
[![license](https://img.shields.io/npm/l/@natjswenson/shipflow)](./LICENSE)

A Claude Code skill that scaffolds a configurable `dev`/`main` branching, auto-merge, branch-cleanup, and release-tagging workflow into any repo.

Run it in a target repo and it detects existing branch protection, CI checks, and release conventions, shows you a plan, and only mutates anything after you confirm. The skill package is identical everywhere — the actual policy (branch names, required checks, release mode, ...) lives in the target repo's own `.github/shipflow.json`, committed and auditable.

## How it works

1. **`/shipflow` in Claude Code** runs an interactive setup interview — detects branch protection, CI, and the default branch, confirms `requiredChecks` and `protectionOwner` with you, and writes `.github/shipflow.json`.
2. **`shipflow plan`** diffs that config against live repo state and shows exactly what would change, before anything is touched.
3. **`shipflow apply`** — only after you confirm — renders `.github/workflows/dev-to-main-automerge.yml` and makes the confirmed mutations. Nothing happens outside what the plan showed.
4. Ongoing: `dev → main` promotions auto-merge once required checks pass; a durable `release-pending` label survives the async gap until a later `shipflow releases` check asks whether to cut a release.

## Quick start

All deterministic work runs through the published CLI:

```sh
npx -y @natjswenson/shipflow@latest detect --repo . --main main --dev dev
```

> **Always pin `@latest`.** Without an explicit version/tag, `npx` can silently resolve a stale install already on your `PATH` instead of fetching the current version from the registry — with no warning. If you've ever run `npm install -g @natjswenson/shipflow` for manual testing, remove it: `npm uninstall -g @natjswenson/shipflow`.

Full interactive setup flow: [`skills/shipflow/SKILL.md`](skills/shipflow/SKILL.md).

## Commands

| Command | What it does |
|---|---|
| `detect --repo <path> [--main <name>] [--dev <name>]` | Inspect live repo state: branch protection, CI checks, release conventions |
| `plan --repo <path>` | Diff `.github/shipflow.json` against live state; prints what would change + a state hash |
| `apply --repo <path> --expect-state-hash <hash> [--dry-run] [--force <id> --force-reason <text>]` | Apply a confirmed plan |
| `releases --repo <path>` | List `dev → main` promotions still labeled `release-pending` |
| `release-dispatch --repo <path> --pr <n> --workflow-file <f>... --ref <ref>` | Dispatch each changed skill's release workflow; clear the label on success |
| `rename-default-branch --repo <path> --branch <old> --to <new>` | One-time bootstrap: rename a repo's default branch |

Every command prints JSON to stdout.

## Status

**`release.mode: "manual-gate"`** (the only implemented mode) is live-validated end-to-end — dogfooded on this repo (`claude-skills`) and an external repo (`natejswenson/1.00s`). A full Siege security audit found and fixed 9 findings (1 Critical, 1 High, the rest Medium/Low) before wider rollout; zero Critical/High findings remain open. See [`CHANGELOG.md`](./CHANGELOG.md) for the fix-by-fix history.

**`release.mode: "auto"`** (fully automatic tagging via `release-please`) is accepted in the config schema but not yet implemented — `apply` refuses with a clear error until it ships.

## Design

[`docs/plans/2026-07-14-shipflow-skill-design.md`](../../docs/plans/2026-07-14-shipflow-skill-design.md) — the full design (7 rounds of adversarial review, score 12 → 0).

## License

MIT
