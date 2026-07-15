# CLAUDE.md — claude-skills monorepo

A monorepo of self-contained, independently-released Claude Code skills. Each skill under
`skills/<name>/` is versioned, tested, and released on its own cadence with a namespaced tag
(`<skill>-v<version>`). This file is the source of truth for the **branch and release process** —
read it before opening any PR.

## Golden rules (read first)

- **Never PR a feature branch straight into `main`.** The only path to `main` is a `dev → main`
  promotion PR. Feature work goes `feature/* → dev`, then `dev → main`. (If a feature PR is
  accidentally opened against `main`, retarget its base to `dev`: `gh pr edit <n> --base dev`.)
- **Never push directly to `main`.** It is protected; the four `ci / <skill>` checks must pass and
  a PR is required. `dev` is unprotected — direct pushes there are fine.
- **A release is cut by a version bump, not by a merge.** To release a skill, bump its version
  (`package.json` for node skills, `SKILL.md` frontmatter `version:` for python skills, **and**
  `plugin.json.version` in `skills/<skill>/.claude-plugin/plugin.json` for all skills — the Tier-1.5
  lint fails the PR if it diverges) **and** add a `CHANGELOG.md` entry in the same change. A
  `dev → main` merge with no bump is a no-op release.
- **Always delete a feature branch as soon as it's merged** — local *and* remote. The repo has
  `delete_branch_on_merge` on, so a PR merged on GitHub auto-removes its head. If you merge or
  integrate any other way (CLI, direct push, squash), delete the branch by hand:
  `git push origin --delete <branch>` + `git branch -D <branch>`. Never leave merged branches around.
  (`dev` and `main` are deletion-protected, so auto-delete only ever eats `feature/*` heads.)
- **Keep this file current in the same PR.** Any change to the branch model, CI, release flow, or
  repo settings updates the relevant section here as part of that same change, not as a follow-up.

## Branch model

```
feature/* ──PR──▶ dev ──PR (auto-merge on green)──▶ main ··· release tags cut manually
```

- **`main`** — default + protected release branch. Required: a PR, the four `ci / <skill>` checks
  green, no force-push, no deletion. **0 required approvals** (solo maintainer self-merges).
  **`enforce_admins: false`** — the admin keeps a direct-push break-glass path; protection is a
  discipline gate for the normal flow, not a hard wall.
- **`dev`** — integration branch, push-open (no required checks/PR — direct and force pushes allowed)
  but **deletion-protected**. Land feature work here (via PR or direct push). `dev` is long-lived;
  the deletion lock is what lets repo-wide `delete_branch_on_merge` run without eating `dev` on a
  `dev → main` merge.
- **Feature branches are deleted on merge** (`delete_branch_on_merge`); only `feature/*` heads are
  ever auto-removed since `dev`/`main` are deletion-protected.
- Merge style: **merge commit** for `dev → main` (keeps `dev` and `main` linked so `dev` never
  diverges and needs no reset). Feature → `dev` is typically squashed for a clean integration commit.

## Shipflow-managed automation

The `dev → main` auto-merge workflow and the release-ask flow are managed by the `shipflow` skill
this repo ships, dogfooded on itself. `.github/shipflow.json` is the committed policy source of
truth for that automation (branch names, merge methods, branch cleanup, release mode). Branch
*protection* itself is **not** shipflow-owned here (`protectionOwner: "external"` — see Repo
settings, below) — `.github/repo-settings.sh` stays the source of truth for that.

**Always invoke the CLI as `npx -y @natjswenson/shipflow@latest <command>` — never bare
`@natjswenson/shipflow`.** Without a version/tag, `npx` prefers a stale install already on `PATH`
(e.g. a leftover `npm install -g`) over fetching the current version from the registry, silently
and with no warning. This bit this exact repo during the 2026-07-15 PAT-wiring dogfood run: a bare
invocation silently ran a stale global 0.2.0 install, missing every fix through 0.2.5 (including a
Critical template-injection fix). Every command below already pins `@latest`; keep it that way in
any new invocation you add here.

- `.github/workflows/dev-to-main-automerge.yml` is **rendered by shipflow's `apply`**, not
  hand-written. Never edit it directly — edit `.github/shipflow.json` and re-run
  `npx -y @natjswenson/shipflow@latest apply --repo .` (it refuses to overwrite a hand-edited file it
  detects a hash mismatch on). If a re-render does change it, commit the file and the config's
  updated `renderedTemplateHashes` entry together.
- To check for drift between this config and live repo state at any time:
  `npx -y @natjswenson/shipflow@latest plan --repo .`.
- To check for a release decision waiting on a merged promotion:
  `npx -y @natjswenson/shipflow@latest releases --repo .` (see step 4 below).

## Release process (step by step)

**Auto-merge and release tagging are decoupled.** Promoting `dev → main` auto-merges on green; it
does **not** cut a release tag on its own. Cutting a tag is a separate, deliberate step.

1. **Branch off `dev`**, do the work. Each skill must keep its own tests green (`ci / <skill>` runs them).
2. **Land it on `dev`** — open a PR into `dev` and merge it, or push directly (dev is unprotected).
3. **Promote: open a PR from `dev` into `main`.** The shipflow-rendered **`auto-merge dev to main`**
   workflow (`.github/workflows/dev-to-main-automerge.yml`) turns on GitHub native auto-merge, and
   the PR **merges itself once all four `ci / <skill>` checks pass**. If any check fails, it never
   merges.
   - **Hold a promotion** by opening the `dev → main` PR as a **draft** — `gh pr merge --auto` will
     not succeed against a draft. **Known gap (shipflow v0.2.0):** the rendered workflow's trigger
     list omits `ready_for_review`, so marking the draft ready for review does **not** re-fire the
     auto-merge job on its own — push an empty commit (or close/reopen) to force a `synchronize`/
     `reopened` event once it's ready. Tracked as a follow-up against the shipflow skill.
4. **No synchronous ask anymore.** The same workflow's `label-release-pending` job attaches a
   durable `release-pending` label **once the promotion PR actually merges** (not when it's opened —
   native auto-merge completes asynchronously with no live agent session attached at that moment).
   A **separate, later** invocation checks for it:
   ```
   npx -y @natjswenson/shipflow@latest releases --repo .
   ```
   For each promotion returned with `merged: true`, the agent lists which skills changed and asks
   whether to cut a release. Declining is final for that promotion in this version — there's no
   "defer" state, the label just stays (expected, not a bug; a later manual dispatch is still safe).
5. **If a release is wanted**, first ensure that skill's version is bumped (`package.json` for node
   skills, `SKILL.md` frontmatter `version:` for python skills, **and `plugin.json.version` in
   `skills/<skill>/.claude-plugin/plugin.json` for all skills**) with a matching `CHANGELOG.md` entry.
   `plugin.json.version` is a required-mutually-equal field — the Tier-1.5 `lint_plugin.py` step in
   that skill's `ci` job fails the `dev → main` PR if it diverges from the other present version
   fields, so this is normally caught before merge, not at release time (release runs via
   `workflow_dispatch`, which the PR-time lint doesn't gate — see the marketplace design doc's Data
   Flow section).
6. **Dispatch and clear the label together:**
   ```
   npx -y @natjswenson/shipflow@latest release-dispatch --repo . --pr <number> \
     --workflow-file <skill1>.yml --workflow-file <skill2>.yml --ref main
   ```
   This is a thin wrapper around `gh workflow run <skill>.yml --ref main` per changed skill, plus
   clearing the `release-pending` label **only after every dispatch is confirmed successful** — a
   partial failure leaves the label in place so the promotion resurfaces on the next `releases` check
   (re-dispatching an already-released skill is a safe idempotent no-op). The `release` job runs the
   version-driven `_release` reusable workflow: it cuts the `<skill>-v<version>` tag + a GitHub
   Release with notes from `CHANGELOG.md` (skipped if the tag already exists), and — for skills with
   `npm-publish: true` — publishes to npm when that version isn't on the registry yet.

   To cut only the GitHub tag/Release without npm, `gh release create` also works:
   ```
   awk '/^## \[<version>\]/{f=1;next} /^## \[/{f=0} f' skills/<skill>/CHANGELOG.md > /tmp/notes.md
   gh release create "<skill>-v<version>" --target "$(gh api repos/<owner>/<repo>/commits/main --jq .sha)" \
     --title "<skill> v<version>" --notes-file /tmp/notes.md
   ```
   (this bypasses `release-dispatch`, so clear the `release-pending` label by hand:
   `gh pr edit <number> --remove-label release-pending`.)

> The per-skill `release` job (`needs: ci`) runs on a real push to `main` **or** an on-demand
> `workflow_dispatch` (step 6). The bot `GITHUB_TOKEN` auto-merge does not fire push events, so the
> dispatch is the deliberate release trigger. Full publish-on-merge would still need re-coupling via
> a `RELEASE_PAT` so the auto-merge push fires downstream workflows.

## CI architecture (how the gate works)

- One reusable **`_release.yml`** (`workflow_call`) + one caller **`<skill>.yml`** per skill +
  **`tools.yml`** (shared `tools/score_skill.py` scorer) + the shipflow-rendered
  **`dev-to-main-automerge.yml`**.
- Each caller has a **`ci` job** (Tier-1 `tools/score_skill.py` SKILL.md lint + the skill's own
  Tier-2 tests) and a **`release` job** (`needs: ci`, runs only on push to `main`).
- **Why all four checks always pass on any PR:** the `pull_request` trigger is **un-filtered**, so
  every `ci / <skill>` check reports on every PR — running real tests when that skill changed, and
  short-circuiting to success (via `dorny/paths-filter`) when it didn't. This is what makes the
  required-check set always satisfiable, so a `dev → main` PR can auto-merge no matter which skills
  it touches. **The `push` trigger IS path-filtered** so a skill only releases when its own files
  changed.

## Repo settings (as code)

`.github/repo-settings.sh` is the idempotent source of truth for repo + `main`/`dev` **protection**
(run by an admin with `gh`). Branch/auto-merge/release-label **automation** is a separate concern,
owned by `.github/shipflow.json` (see Shipflow-managed automation, above) — shipflow's
`protectionOwner: "external"` config means it defers to this script for protection and never
installs a competing ruleset. Key settings here:

- `allow_auto_merge: true`, `allow_merge_commit: true` — required for the `dev → main` auto-merge.
- `delete_branch_on_merge: true` — **safe only because `dev` is separately deletion-protected**
  (`allow_deletions: false` in its branch protection, set by this same script). A `dev → main` PR's head is `dev`,
  so delete-on-merge would otherwise delete the long-lived `dev` branch; the deletion lock is what
  stops that, letting repo-wide auto-cleanup run and only ever eat `feature/*` heads.
- `main` required checks: `ci / devlog`, `ci / resume`, `ci / ghostwriter`, `ci / github-stats`.
  These names are the job `name:` values — **renaming a caller or its `ci` job silently
  un-requires it; update branch protection in the same change.**

**Bootstrap note:** `dev-to-main-automerge.yml` is a plain `pull_request`-triggered workflow (not
`pull_request_target`), so unlike the auto-merge workflow it replaced, it needs **no manual-merge
bootstrap** — GitHub evaluates `pull_request` workflows from the PR's merge ref, so the file fires
correctly on the very first `dev → main` PR that introduces it, as long as it already exists on
`dev` (the head).

## Adding a new skill

1. Copy a caller `<skill>.yml`. **Keep the `pull_request` trigger un-filtered** and **keep the `ci`
   job's `permissions: { contents: read, pull-requests: read }`** — both are load-bearing
   (`pull-requests: read` lets `dorny/paths-filter` detect changes under the restricted default
   token; dropping it red-lines the required check on every PR).
2. Path-filter only the `push` trigger to `skills/<skill>/**` (+ `tools/score_skill.py` +
   `tools/lint_plugin.py` + the caller).
3. Set the release call `with: { skill: <skill> }` (+ `version-source` if not auto-detectable).
4. Ensure the skill has `CHANGELOG.md` and a version (package.json or SKILL.md frontmatter).
5. **Add `ci / <skill>` to `main`'s required checks** (and to `.github/repo-settings.sh`).
6. Add `skills/<skill>/.claude-plugin/plugin.json` with `name` == the directory name (== SKILL.md
   `name:` — never `package.json.name`, see the marketplace design doc's F1 rule) and `version`
   equal to the skill's resolved version.
7. Add a `{name, source}` entry for the new skill to root `.claude-plugin/marketplace.json`
   (`source` must be `./skills/<skill>`; `name` must equal both the directory name and the
   `plugin.json.name` at that source).
8. Add the Tier-1.5 `python tools/lint_plugin.py skills/<skill>` step to the new caller's `ci` job,
   right after its `score_skill.py` step, gated on the same `steps.changes.outputs.<skill>`
   condition as every other step. `ci / marketplace` needs no per-skill change — its unconditional
   lint validates every skill's `plugin.json` and the marketplace membership invariant automatically.
9. **`SKILL.md` (and everything the skill's own instructions reference — `scripts/`, `tests/`,
   `package.json`, etc.) goes at `skills/<skill>/skills/<skill>/SKILL.md`, one level deeper than
   the plugin root** — Claude Code's plugin auto-discovery only scans `skills/<subdir>/SKILL.md`,
   never a root-level `SKILL.md` (verified against every plugin in
   `anthropics/claude-plugins-official`; Claude Desktop enforces this even though the CLI
   currently tolerates a root-level fallback — don't rely on that). Only `.claude-plugin/`,
   `LICENSE`, `README.md`, and `CHANGELOG.md` stay at the outer `skills/<skill>/` level. The
   `score_skill.py` CI invocation argument must point at the nested path
   (`skills/<skill>/skills/<skill>`); `lint_plugin.py`'s argument stays the plugin root — it
   resolves the nested SKILL.md/package.json path internally.

## Design docs

- `docs/plans/2026-06-19-repo-cicd-reusable-workflows-design.md` — the reusable-CI + per-skill-test design.
- `docs/plans/2026-06-25-dev-to-main-auto-merge.md` — the `dev → main` auto-merge design.
- `docs/plans/2026-07-10-marketplace-plugin-topology-design.md` — the plugin-marketplace topology
  design (plugin.json/marketplace.json, the two new lint scripts, `ci / marketplace`).
