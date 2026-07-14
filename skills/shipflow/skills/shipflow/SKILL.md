---
name: shipflow
description: Scaffold a configurable dev/main branching, auto-merge, branch-cleanup, and release-tagging workflow into any repo. Detects existing branch protection, CI checks, and release conventions; always shows a plan and waits for confirmation before mutating anything. Use when the user asks to set up branch protection standards, apply deployment/release standards to a repo, or wants long-lived dev/main branches with auto-merge and branch cleanup.
user_invocable: true
---

# /shipflow — branching + release-automation setup

All deterministic work is delegated to the CLI. Invoke it as
`npx -y @natjswenson/shipflow <command>`. Every command prints JSON to
stdout — parse it, don't try to re-derive what it computed.

**This skill never mutates repo state directly.** Every mutating action goes
through `shipflow apply`, and the computed plan is always shown to the user
and confirmed before the real (non-dry-run) apply runs. This is the
deterministic/nondeterministic split: you decide *what* and confirm with the
user; the CLI is the only thing that *does*.

## Decide which mode you're in

| Situation | Mode |
|---|---|
| `.github/shipflow.json` doesn't exist in the target repo yet | **First-run setup** |
| `.github/shipflow.json` exists, user wants to check/repair drift | **Re-run / audit** |
| User asks "any releases pending?" / periodic check-in / after a `dev → main` merge | **Check pending releases** |

## First-run setup

1. **Detect.** Run:
   ```
   npx -y @natjswenson/shipflow detect --repo <path> --main main --dev dev
   ```
   (Use whatever branch names the user has, or `main`/`dev` as a starting guess — you'll confirm them next.) This prints a `RepoState` plus a `protectionOwnerClassification` of `"external"`, `"shipflow"`, or `"ambiguous"`.

2. **Confirm branch names and required checks with the user.** Show `workflows.jobNames` from the detect output as candidate `requiredChecks` and let the user confirm/edit the list. **An empty `requiredChecks` list is a fail-open state, not a valid steady state** — `shipflow apply` will hard-refuse to enable auto-merge with zero required checks (see Error handling below). Don't let the user skip this without understanding that consequence.

3. **Resolve `protectionOwner`:**
   - `"external"` → tell the user which settings-as-code artifact was found (`settingsAsCodeArtifact` in the detect output) and that shipflow will defer to it, managing only cleanup/automerge/release, not installing a competing ruleset.
   - `"shipflow"` → tell the user no existing branch protection was found and shipflow will own it going forward.
   - `"ambiguous"` → **branch protection exists but no settings-as-code artifact was found** (e.g. hand-configured via the GitHub UI). Do NOT silently pick either value — this is exactly the false-positive failure mode a prior design iteration got wrong. Ask explicitly: *"Branch protection exists on this repo but isn't managed as code — should shipflow take ownership of it, or keep managing it externally even though no artifact was found?"* Record whichever the user picks.

4. **Write `.github/shipflow.json`** in the target repo (never inside the skill package) using `config.example.json` as the template, with the confirmed branch names, `requiredChecks`, `protectionOwner`, and `release.mode: "manual-gate"` (the only implemented mode in this version — see Auto mode, below).

5. **Show the plan.** Run:
   ```
   npx -y @natjswenson/shipflow plan --repo <path>
   ```
   This prints `{ plan, stateHash }`. Present `plan.creates`/`plan.updates`/`plan.noops` to the user in plain language — what will be created, what will change, what's already correct. **Wait for explicit confirmation before proceeding.** If any entry has `handEditDetected: true`, call it out specifically and ask whether to override (see step 7).

6. **Dry-run apply** (optional sanity check, same output shape as the real apply but nothing is mutated):
   ```
   npx -y @natjswenson/shipflow apply --repo <path> --dry-run
   ```

7. **Apply for real**, passing the `stateHash` from step 5's plan output as `--expect-state-hash` — this is the TOCTOU guard: if repo state drifted between the plan you showed the user and this call, `apply` refuses to mutate anything and tells you to re-plan.
   ```
   npx -y @natjswenson/shipflow apply --repo <path> --expect-state-hash <hash-from-step-5>
   ```
   If a `handEditDetected` entry was confirmed for override in step 5, pass `--force <entry-id>` (repeatable — one flag per confirmed entry id, never a blanket override).

8. **Report the result.** Read `applied`/`skipped`/`errors` from the response. If `renderedTemplateHashes` is non-empty, update `.github/shipflow.json`'s `renderedTemplateHashes` field with those values and tell the user to commit the config change *and* the rendered workflow file **together, in the same commit** — a split commit is exactly what causes a false `handEditDetected` on a clean checkout later.

## Re-run / audit

Same as steps 1, 5, 6, 7, 8 above, skipping the interview (branch names/checks/protectionOwner are already recorded in `.github/shipflow.json` — read it, don't re-ask, unless the user explicitly says they want to reconfigure). If `plan.creates`/`plan.updates` is non-empty, that's drift since the last apply — show it and confirm before applying, exactly as in first-run setup.

## Check pending releases (`manual-gate` ask-flow)

This is a **separate, later invocation** from the one that ran the promotion's `apply` — native GitHub auto-merge completes asynchronously, with no live session attached at the moment of the actual merge. A durable `release-pending` label is what survives that gap.

1. Run:
   ```
   npx -y @natjswenson/shipflow releases --repo <path>
   ```
   This returns every `dev → main` PR still labeled `release-pending`, each with a `merged` flag (confirmed independently, not just inferred from the label).

2. For **each** promotion returned (there can be more than one if several merged before you last checked — handle the whole list, not just the most recent): if `merged` is `false`, skip it for now (native auto-merge hasn't landed yet; don't ask about a promotion that isn't actually on `main`). If `merged` is `true`, ask the user: *"A promotion merged to main — cut a release for [changed skills]?"*

3. If yes, dispatch each changed skill's release workflow and clear the label **only after every dispatch is confirmed successful**:
   ```
   npx -y @natjswenson/shipflow release-dispatch --repo <path> --pr <number> --workflow-file <skill1>.yml --workflow-file <skill2>.yml --ref main
   ```
   If `dispatched` shows a partial failure, the label is deliberately left in place — report this to the user and note the promotion will resurface next time `releases` is checked; a later re-dispatch is safe (each skill's release workflow is idempotent).

4. If no, leave the label as-is — there is no "defer" state in this version; declining is final for that promotion short of a manual dispatch. (Deliberate v1 simplification, not an oversight.)

## Auto mode (not yet implemented)

`release.mode: "auto"` is a valid value in the config schema (the full design covers automatic tagging via `release-please`), but `shipflow apply` in this version **refuses to run** against a config with `release.mode: "auto"`, with a clear error rather than silently no-oping. If a user asks for fully automatic tagging, tell them it's designed but not yet shipped (see `CHANGELOG.md`) and that `"manual-gate"` — the deliberate ask-before-tagging flow above — is what's available today.

## Error handling

- **Empty `requiredChecks`:** `apply` refuses to wire up auto-merge with zero required checks. Don't work around this by suggesting `--force allow-no-checks` unless the user has explicitly and knowingly accepted an unprotected merge — surface the refusal message plainly first.
- **`handEditDetected`:** a template file's on-disk content doesn't match what shipflow last rendered *or* what it would freshly render — someone hand-edited it. Never silently pass `--force` for this; always show the user what changed and get explicit confirmation per entry.
- **TOCTOU abort:** if `apply` returns a `toctou` error, repo state changed between plan and apply — re-run the plan step, don't retry the same `--expect-state-hash`.
- **`gh auth` failures:** surface these immediately; branch protection and rulesets need repo-admin scope. Don't proceed partway through a plan on missing auth.

## Security rules

- All `gh`/`git` invocations in the CLI are argv-style (`spawnSync` with an args array, no shell) — never construct a shell command string from user input when extending this skill.
- `.github/shipflow.json` is committed policy, not secrets — never write credential *values* into it, only the *name* of a secret (`release.releaseCredential`).
- Never write shipflow's config anywhere other than `.github/shipflow.json` in the target repo.

## Edge cases

- **Greenfield repo, no CI yet:** `requiredChecks` will detect empty. Don't silently proceed — tell the user auto-merge can't be enabled until at least one check exists, and that's a real ordering dependency (CI first, then shipflow setup), not a shipflow bug.
- **Repo already has `shipflow.json` with `release.mode: "auto"`:** refuse per "Auto mode," above, even on a re-run/audit — don't silently downgrade it to `"manual-gate"` either; surface the refusal and let the user decide.
