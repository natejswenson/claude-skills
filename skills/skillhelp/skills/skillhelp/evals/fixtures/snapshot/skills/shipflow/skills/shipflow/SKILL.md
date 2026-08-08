---
name: shipflow
description: Scaffold a configurable dev/main branching, auto-merge, branch-cleanup, and release-tagging workflow into any repo. Detects existing branch protection, CI checks, and release conventions; always shows a plan and waits for confirmation before mutating anything. Use when the user asks to set up branch protection standards, apply deployment/release standards to a repo, or wants long-lived dev/main branches with auto-merge and branch cleanup.
user_invocable: true
---

# /shipflow — branching + release-automation setup

All deterministic work is delegated to the CLI. Invoke it as
`npx -y @natjswenson/shipflow@latest <command>` — **always with the explicit
`@latest` tag, never bare `@natjswenson/shipflow`.** Without a version/tag,
`npx` prefers an already-resolvable install on `PATH` (e.g. a stale global
`npm install -g @natjswenson/shipflow` from a prior manual test) over
fetching the current version from the registry, and does so silently with
no warning. This isn't hypothetical: it happened in this exact repo — the
same command with the `@latest` tag omitted silently ran a stale global
0.2.0 install (missing every fix through 0.2.5, including the Critical
template-injection fix), while `npx -y @natjswenson/shipflow@latest -v`
correctly resolved 0.2.5. Every command prints JSON to stdout — parse it,
don't try to re-derive what it computed.

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
| User wants to cut a release for one named thing ("release devlog") | **Cut a component release** |

## First-run setup

**This whole section is a mandatory interactive interview, not a narrate-and-proceed pass.** Steps 2–4 below must end with the agent presenting a plain-language summary of what was detected and what's about to be written, and waiting for the user's explicit go-ahead — even when detected values already look correct. Never go from step 1's `detect` straight to step 4's config write without that confirmation turn; a value looking right is not the same as the user confirming it.

1. **Detect.** Run:
   ```
   npx -y @natjswenson/shipflow@latest detect --repo <path> --main main --dev dev
   ```
   (Use whatever branch names the user has, or `main`/`dev` as a starting guess — you'll confirm them next.) This prints a `RepoState` plus a `protectionOwnerClassification` of `"external"`, `"shipflow"`, or `"ambiguous"`, and now also a `rankedPatterns` array — every pattern's `{id, score, evidence}`, sorted descending by score.

2. **Resolve `workflowPattern` before anything else** — a `github-flow` repo never asks about a `dev` branch name at all, so this has to happen before step 3 below. Classify `rankedPatterns` per these rules: **confident** if the top score is `>= 0.7` AND the gap over the second-place score is `> 0.3`; **greenfield** if the top score is `< 0.4`; **ambiguous** otherwise (the residual case — no separate condition to satisfy).
   - **Confident:** state what was detected and why (the top entry's `evidence` array) — *"I detected this repo is using **`<pattern-id>`** because: `<evidence bullets>`. I'll set `workflowPattern` to this — confirm before I proceed, or tell me if you'd rather pick a different pattern."* This is still a confirm-before-write checkpoint per this section's mandatory-interview rule — a confident autodetect is not a substitute for the user's explicit confirmation.
   - **Ambiguous or greenfield:** present all 3 patterns and ask the user to choose. Do not silently pick one:
     - `dev-main-promotion` — long-lived `dev` + `main`; a promotion PR auto-merges `dev` into `main`.
     - `github-flow` — single long-lived `main`; every PR merges (and auto-merges) directly to `main`. Suggest this as the lightweight default for a **greenfield** repo specifically, without auto-picking it.
     - `gitflow` — `develop` + `main` + transient `release/*`/`hotfix/*` branches, for software that maintains multiple released versions concurrently.
   - Once resolved, proceed with only the interview fields that pattern's config actually uses — skip asking about a `dev` branch name under `github-flow`, for instance.
   - If `workflowPattern` is `gitflow`, additionally ask for `releaseBranchPrefix`/`hotfixBranchPrefix` (defaulting to `release/`/`hotfix/` if the user has no preference) — recorded under `patternConfig.gitflow` in the config.

3. **Resolve a default-branch mismatch, if any.** Compare `repoState.repoSettings.defaultBranch` (the repo's actual GitHub default branch) to the `--main` name used in step 1. If they match, skip to step 4. If they differ (e.g. the repo's default is `master`), ask the user explicitly — do not silently assume either path:
   - **Map onto the existing default branch** — set the config's `branches.main` to the detected default branch name and continue with the rest of setup treating that as "main." No mutating calls needed; `branches.main` is fully configurable.
   - **Switch the repo's default branch to `main`** — flag this as a bigger, more disruptive action than the rest of setup (it affects every collaborator and every open PR), get a distinct explicit confirmation for it specifically, separate from the general setup go-ahead, then run:
     ```
     npx -y @natjswenson/shipflow@latest rename-default-branch --repo <path> --branch <old-default> --to main
     ```
     GitHub natively retargets the default-branch pointer and open PRs' base ref. On success, tell the user their own local checkout still points at the old name and needs `git fetch origin && git checkout main` to follow, then re-run step 1's `detect` (repo state changed) before continuing.

4. **Confirm branch names and required checks with the user.** Show `workflows.jobNames` from the detect output as candidate `requiredChecks` (this list is already filtered to jobs from workflows that actually trigger on `pull_request` — a job that only runs on `schedule`/`workflow_dispatch` can never satisfy a required check, so it's never offered as a candidate) and let the user confirm/edit the list. **An empty `requiredChecks` list is a fail-open state, not a valid steady state** — `shipflow apply` will hard-refuse to enable auto-merge with zero required checks (see Error handling below). Don't let the user skip this without understanding that consequence.

   **If the candidate list is empty, a CI workflow has to exist before auto-merge
   can be enabled. Hand that job to the `ghfactory` skill** — authoring and *verifying*
   workflow YAML is its whole subject, and it does things shipflow never will:
   it resolves every action ref against the real API (no linter checks that an
   action exists), validates each `with:` key against the action's own
   `action.yml`, reports how many majors behind each pin is, and runs actionlint
   and zizmor before showing you anything. Two skills answering "scaffold me a CI
   workflow" differently is worse than either answer.

   > Use the ghfactory skill to create a `pull_request`-triggered build+test workflow
   > for this repo, then come back here with the job name.

   **If ghfactory is not installed**, draft it here instead: investigate the repo
   directly (`package.json`, `Cargo.toml`, `project.yml`/`.xcodeproj`, `go.mod`,
   `pyproject.toml`, or whatever's actually there) and write a minimal,
   conservative `pull_request`-triggered build+test workflow.
   **Never silently overwrite an existing workflow file.** Present it and wait for
   explicit confirmation before writing it — the same confirm-before-write pattern
   as everything else in this skill.

   Either way, say plainly that a fresh workflow is a starting point, not a
   guarantee it's green on the first run — **a required check that never passes
   blocks every future merge**, so the user should watch it run successfully
   before relying on it as one. Once it exists, re-run step 1's `detect` (repo
   state changed) and continue this step with the new job name as a real candidate.

5. **Resolve `protectionOwner`:**
   - `"external"` → tell the user which settings-as-code artifact was found (`settingsAsCodeArtifact` in the detect output) and that shipflow will defer to it, managing only cleanup/automerge/release, not installing a competing ruleset.
   - `"shipflow"` → tell the user no existing branch protection was found and shipflow will own it going forward.
   - `"ambiguous"` → **branch protection exists but no settings-as-code artifact was found** (e.g. hand-configured via the GitHub UI). Do NOT silently pick either value — this is exactly the false-positive failure mode a prior design iteration got wrong. Ask explicitly: *"Branch protection exists on this repo but isn't managed as code — should shipflow take ownership of it, or keep managing it externally even though no artifact was found?"* Record whichever the user picks.

6. **Resolve `release.releaseCredential` — never default it to `GITHUB_TOKEN`.** The rendered auto-merge workflow's `GH_TOKEN` comes from this secret name. A PR auto-merged under `secrets.GITHUB_TOKEN` completes (once checks pass) attributed to the `github-actions[bot]` identity, and GitHub's loop-prevention rule means that bot-attributed merge's `pull_request: closed` event **never triggers this or any other workflow** — so `label-release-pending` silently never runs, and the entire manual-gate release-ask flow never has anything to find. This was confirmed empirically, not theoretically: an otherwise-identical PR merged by a real, PAT-authenticated actor fired the closed-event trigger within 2 seconds; one completed by `GITHUB_TOKEN`-enabled auto-merge fired no run at all, even after 100+ seconds. Ask the user to create a fine-grained PAT (or GitHub App installation token) scoped to this repo with `contents: write` + `pull-requests: write`, and to store it as a repo secret themselves (e.g. `gh secret set <NAME> --repo <owner>/<repo>`, run in *their own* shell so the token value never passes through the agent or the transcript). Record only the secret's *name* in `release.releaseCredential` — never its value.

7. **Present the interview summary and write `.github/shipflow.json`.** Before writing anything, show the user the resolved `workflowPattern`, branch names, `requiredChecks`, `protectionOwner`, and `release.releaseCredential` together in one place and wait for explicit confirmation — this is the checkpoint called out at the top of this section. Then write the config in the target repo (never inside the skill package) using `config.example.json` as the template, with `release.mode: "manual-gate"` (the only implemented mode in this version — see Auto mode, below). Tell the user `.github/shipflow.json` is committed policy and should be `git add`/committed — ideally in the same commit as the rendered auto-merge workflow(s), once step 11 produces them.

8. **Show the plan.** Run:
   ```
   npx -y @natjswenson/shipflow@latest plan --repo <path>
   ```
   This prints `{ plan, stateHash }`. Present `plan.creates`/`plan.updates`/`plan.noops` to the user in plain language — what will be created, what will change, what's already correct. **Wait for explicit confirmation before proceeding.** If any entry has `handEditDetected: true`, call it out specifically and ask whether to override (see step 10).

9. **Dry-run apply** (optional sanity check, same output shape as the real apply but nothing is mutated):
   ```
   npx -y @natjswenson/shipflow@latest apply --repo <path> --dry-run
   ```

10. **Apply for real**, passing the `stateHash` from step 8's plan output as `--expect-state-hash` — this is the TOCTOU guard: if repo state drifted between the plan you showed the user and this call, `apply` refuses to mutate anything and tells you to re-plan. **`--expect-state-hash` is mandatory for a real (non-dry-run) apply** — omitting it is a hard CLI refusal, not a silent skip of the check; the only way around it is the explicitly-named `--skip-hash-check` escape hatch, which you should never reach for as a matter of course.
    ```
    npx -y @natjswenson/shipflow@latest apply --repo <path> --expect-state-hash <hash-from-step-8>
    ```
    If a `handEditDetected` entry was confirmed for override in step 8, pass `--force <entry-id>` (repeatable — one flag per confirmed entry id, never a blanket override) **and** `--force-reason "<short justification>"` — the CLI refuses any `--force` without an accompanying reason, and that reason is echoed back in the apply result for auditability. Write a real justification tied to the user's actual confirmation (e.g. `--force-reason "user confirmed hand-edit override for the branch-rename migration on 2026-07-15"`), never a placeholder string.

11. **Report the result.** Read `applied`/`skipped`/`errors` from the response. A `skipped` entry can be a deliberate refusal (empty checks, hand-edit) or an environment limitation shipflow can't do anything about (e.g. a deletion-ruleset skipped because the repo is private and not on a paid GitHub tier) — read each `reason` and relay it plainly rather than treating every `skipped` entry the same. If `renderedTemplateHashes` is non-empty, update `.github/shipflow.json`'s `renderedTemplateHashes` field with those values and tell the user to commit the config change *and* the rendered workflow file(s) **together, in the same commit** — a split commit is exactly what causes a false `handEditDetected` on a clean checkout later.

## Re-run / audit

Same as steps 1, 8, 9, 10, 11 above, skipping the interview (`workflowPattern`/branch names/checks/protectionOwner/releaseCredential are already recorded in `.github/shipflow.json` — read it, don't re-ask, unless the user explicitly says they want to reconfigure). Step 2's pattern resolution never runs on a re-run — `workflowPattern`'s absence from a config genuinely means "not yet resolved," and its presence means "already resolved," so there's nothing to detect again. If `plan.creates`/`plan.updates` is non-empty, that's drift since the last apply — show it and confirm before applying, exactly as in first-run setup.

## Check pending releases (`manual-gate` ask-flow)

This is a **separate, later invocation** from the one that ran the promotion's `apply` — native GitHub auto-merge completes asynchronously, with no live session attached at the moment of the actual merge. A durable `release-pending` label is what survives that gap.

1. Run:
   ```
   npx -y @natjswenson/shipflow@latest releases --repo <path>
   ```
   This returns every `dev → main` PR still labeled `release-pending`, each with a `merged` flag (confirmed independently, not just inferred from the label).

2. For **each** promotion returned (there can be more than one if several merged before you last checked — handle the whole list, not just the most recent): if `merged` is `false`, skip it for now (native auto-merge hasn't landed yet; don't ask about a promotion that isn't actually on `main`). If `merged` is `true`, ask the user: *"A promotion merged to main — cut a release for [changed skills]?"*

3. If yes, dispatch each changed skill's release workflow and clear the label **only after every dispatch is confirmed successful**:
   ```
   npx -y @natjswenson/shipflow@latest release-dispatch --repo <path> --pr <number> --workflow-file <skill1>.yml --workflow-file <skill2>.yml --ref main
   ```
   If `dispatched` shows a partial failure, the label is deliberately left in place — report this to the user and note the promotion will resurface next time `releases` is checked; a later re-dispatch is safe (each skill's release workflow is idempotent).

4. If no, leave the label as-is — there is no "defer" state in this version; declining is final for that promotion short of a manual dispatch. (Deliberate v1 simplification, not an oversight.)

## Cut a component release

For the conversational "release devlog" flow, prefer the **`release` skill** — it owns the
bump judgment, the CHANGELOG prose and the run presentation. This section is the CLI contract
underneath it, and the fallback when that skill is not installed.

A **component** is one independently-versioned thing in a repo: a skill in a monorepo, or the
repo itself. `release.componentLayout` describes where a component's version, changelog, tag
and release workflow live, with `{name}` as the only substitution token;
`release.components` lists the names. A repo with neither gets a single component inferred from
its root (`package.json`, `CHANGELOG.md`, `v{version}`), so a one-project repo needs no config
at all and `--component` may be omitted.

1. **Read the state. Never guess it.**
   ```
   npx -y @natjswenson/shipflow@latest release-status --repo <path> --component <name>
   ```
   Returns `state`, the version on main and dev, the last tag, every commit since that tag that
   touched this component's paths, a `suggestedBump` with its reason, `blockers`, `notes`, and a
   `statusHash`. `state` decides the path:
   - `clean` — the released version is what's on main. A bump is needed: go to step 2.
   - `untagged-bump-on-main` — the bump is already on main and was never tagged (a cancelled or
     failed release run). **No PR is needed** — `release-cut` dispatches and verifies. Skip to step 3.
     **`untagged-bump-on-main` is not, by itself, permission to cut.** Check `devAhead` first: if
     it is set, dev already carries a *higher* version than what's on main, and cutting here would
     tag the version on main, not the one on dev — the version you almost certainly mean to
     release. `release-cut` refuses in this shape unless you pass `--version` naming exactly which
     one to release (see step 3); it never guesses.
   - `bump-on-dev-unpromoted` — the bump is on dev, waiting for a promotion. Skip to step 3.
   - `version-behind-tag` — main carries a *lower* version than an existing tag. Stop and ask;
     this means a tag was cut from something other than main, and guessing is how it gets worse.

2. **Show the user `collateral`, `blockers` and the proposed version, and wait.**
   A `dev → main` promotion is atomic and carries all of dev, so every component listed under
   `collateral` has its bump moved to `main` by the same promotion. It is **not released** by
   that — every caller's release job is `workflow_dispatch`-only, so merging tags nothing; each
   becomes `untagged-bump-on-main`, one deliberate `release-cut` away from a tag.
   **Never run `release-cut` without naming that list to the user first.** They should know what
   their promotion moves, and which components are now one dispatch from a release nobody asked
   for.

   `suggestedBump` is a suggestion. The user decides, and a `suggestedBumpCapped: true` means a
   breaking change was held at minor because the component is still 0.x — going to 1.0.0 is a
   release decision, never a commit message's. Then:
   ```
   npx -y @natjswenson/shipflow@latest release-prepare --repo <path> --component <name> \
     --version <x.y.z> --notes-file <path>
   ```
   Local only, no network. It works in a **throwaway git worktree**, so unrelated uncommitted work
   in the user's tree is untouched and cannot be swept into the release commit. The version bump
   and the CHANGELOG entry land in **one commit** — the notes are read off `main` at dispatch
   time, so a CHANGELOG that lands in a later promotion than its version is notes the release
   will never carry.

3. **Cut it, and prove it.**
   ```
   npx -y @natjswenson/shipflow@latest release-cut --repo <path> --component <name> \
     --expect-status-hash <hash-from-step-1> --wait 240
   ```
   `--expect-status-hash` is mandatory (same TOCTOU discipline as `apply`'s `--expect-state-hash`);
   `--skip-hash-check` is a named escape hatch, never a default.

   If step 1's `devAhead` was set, `release-cut` refuses outright with an error naming both
   versions — this is the ambiguous three-way state (main has an untagged bump, dev already
   carries something higher) where guessing would tag the wrong one. Promote `dev → main` and
   re-run `release-status` to release what's on dev (the normal recovery), **or** add
   `--version <x.y.z>` naming exactly the version on main, if you deliberately mean to release
   that one and leave dev's higher version for later. `--version` is a confirmation, not a
   bypass — it is only ever accepted when it matches a version already on main or dev; anything
   else is refused the same as passing nothing.

   **`release-cut` is resumable and bounded, and it will usually return `done: false`.** The full
   path — feature PR, checks, merge, promotion, auto-merge, **dispatch**, release run, tag — takes
   longer than one call should block for. Each call advances as far as it can, then returns the
   `stage` it is parked at and a `next` line. **Call it again, unchanged, until `done: true`.** It
   derives every stage from live remote state and never from a record of what a previous call did,
   so a resumed run and a fresh one are the same code path.

   **The promotion merging cuts nothing.** `release-cut` dispatches the component's release
   workflow itself, after the promotion lands — that dispatch is the single point at which any tag
   is created in this repo, which is why a merge can no longer surprise anyone with a release.

4. **Report the tag, and only the tag.** `done: true` carries `tag` and `releaseUrl`, read back
   from origin. A dispatched workflow, a merged PR and a green check are **not** a release —
   `release-cut` confirms the tag exists on the remote before it says done, and so must you.

## Auto mode (not yet implemented)

`release.mode: "auto"` is a valid value in the config schema (the full design covers automatic tagging via `release-please`), but `shipflow apply` in this version **refuses to run** against a config with `release.mode: "auto"`, with a clear error rather than silently no-oping. If a user asks for fully automatic tagging, tell them it's designed but not yet shipped (see `CHANGELOG.md`) and that `"manual-gate"` — the deliberate ask-before-tagging flow above — is what's available today.

## Error handling

- **Empty `requiredChecks`:** `apply` refuses to wire up auto-merge with zero required checks. Don't work around this by suggesting `--force allow-no-checks` (plus the now-mandatory `--force-reason`) unless the user has explicitly and knowingly accepted an unprotected merge — surface the refusal message plainly first.
- **`handEditDetected`:** a template file's on-disk content doesn't match what shipflow last rendered *or* what it would freshly render — someone hand-edited it. Never silently pass `--force` for this; always show the user what changed and get explicit confirmation per entry.
- **TOCTOU abort:** if `apply` returns a `toctou` error, repo state changed between plan and apply — re-run the plan step, don't retry the same `--expect-state-hash`.
- **`gh auth` failures:** surface these immediately; branch protection and rulesets need repo-admin scope. Don't proceed partway through a plan on missing auth.
- **`release.releaseCredential` left as (or defaulted to) `GITHUB_TOKEN`:** auto-merge and the required-check gate still work, but `label-release-pending` will silently never run — a `GITHUB_TOKEN`-attributed auto-merge's `pull_request: closed` event never triggers it, so no promotion will ever surface via `shipflow releases`. This fails silently, not loudly — there's no error to catch it — so it must be caught at setup time (step 5) rather than discovered later. If a user reports "releases never show up," check this first.
- **`--expect-state-hash is required` refusal:** a real apply was attempted with neither `--expect-state-hash` nor `--skip-hash-check`. Go back and get (or re-fetch via `plan`) the hash — don't reach for `--skip-hash-check` just to make the error go away; that flag exists for a deliberate, documented exception, not as a default workaround.
- **`--force was passed without --force-reason` refusal:** a `--force` flag was about to be sent with no accompanying justification. Stop and get (or write) an explicit reason tied to what the user actually confirmed before retrying — never pass a placeholder string just to satisfy the flag.
- **`release-cut` returns `done: false`:** not an error. It is parked at the `stage` it reports,
  waiting on something remote. Call it again with the same arguments. Do not report a release.
- **`release-status` reports `component-files-dirty`:** this component's own version files or
  CHANGELOG have uncommitted edits, so a bump would collide with them. Unrelated dirt elsewhere in
  the tree is reported under `notes` and is deliberately **not** a blocker — `prepare` runs in an
  isolated worktree specifically so other people's in-flight work is safe.
- **`release-status` reports `version-unreadable-on-main`:** the component's version files do not
  exist on main, or they disagree with each other. A disagreement is a hard refusal, never a
  "pick the highest" — releasing from a disagreeing set tags one version and ships another.
- **A `gh`/`git` call hangs or times out:** every subprocess call has a 30-second timeout (`ETIMEDOUT` surfaces in the error message). A timeout on `detect`/`plan` usually means a real GitHub outage or rate-limit — retry once, and if it persists, tell the user rather than looping silently.

## Security rules

- All `gh`/`git` invocations in the CLI are argv-style (`spawnSync` with an args array, no shell) — never construct a shell command string from user input when extending this skill.
- `.github/shipflow.json` is committed policy, not secrets — never write credential *values* into it, only the *name* of a secret (`release.releaseCredential`).
- Never write shipflow's config anywhere other than `.github/shipflow.json` in the target repo.
- **`renderTemplate` validates every substituted value before writing YAML, and this must never be weakened.** `config.branches.dev`/`main` and `release.releaseCredential` are editable by anyone with repo *write* access (not just the admin who ran setup), yet they land in single-quoted YAML string comparisons and a `${{ secrets.X }}` expression with pure string substitution. An unvalidated branch name containing a quote (e.g. `dev' || 'x'=='x`) makes the auto-merge job's `if:` condition unconditionally true — auto-merge would enable on *any* PR to main, not just genuine dev-branch promotions; a value containing a newline can inject arbitrary new YAML steps into the committed, then-executed workflow. If you add a new substitution token, it needs a validator in `TOKEN_VALIDATORS` before it ships — never assume a config field is pre-sanitized.

## Edge cases

- **Greenfield repo, no CI yet:** `requiredChecks` will detect empty. Don't silently proceed — tell the user auto-merge can't be enabled until at least one check exists, and that's a real ordering dependency (CI first, then shipflow setup), not a shipflow bug.
- **Repo already has `shipflow.json` with `release.mode: "auto"`:** refuse per "Auto mode," above, even on a re-run/audit — don't silently downgrade it to `"manual-gate"` either; surface the refusal and let the user decide.
- **Private repo on a free GitHub plan:** the deletion-protection ruleset requires GitHub Pro/Team/Enterprise for private repos (rulesets are free for public repos only). `apply` reports this as a `skipped` entry with that reason, not an `errors` entry — it's an expected environment limitation, not a shipflow bug. Cleanup and the release-pending label still apply normally.
