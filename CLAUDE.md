# CLAUDE.md — claude-skills monorepo

A monorepo of self-contained, independently-released Claude Code skills. Each skill under
`skills/<name>/` is versioned, tested, and released on its own cadence with a namespaced tag
(`<skill>-v<version>`). This file is the source of truth for the **branch and release process** —
read it before opening any PR.

## Golden rules (read first)

- **Never PR a feature branch straight into `main`.** The only path to `main` is a `dev → main`
  promotion PR. Feature work goes `feature/* → dev`, then `dev → main`. (If a feature PR is
  accidentally opened against `main`, retarget its base to `dev`: `gh pr edit <n> --base dev`.)
  A stacked PR layer targets the layer below it and the *bottom* of the stack targets `dev` —
  so `gh stack init` always takes `--base dev`, never the default `main` (see Stacked PRs).
- **Never push directly to `main`.** It is protected; every `ci / <skill>` check must pass and
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

Work that splits into reviewable layers stacks instead of landing as one wide PR (see
Stacked PRs, below). The bottom of a stack targets `dev`; each layer above targets the
layer below it:

```
feature/c ──PR──▶ feature/b ──PR──▶ feature/a ──PR──▶ dev ──▶ main
   └ each PR's diff is only that layer's changes
```

- **`main`** — default + protected release branch. Required: a PR, every `ci / <skill>` check
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

## Stacked PRs

Native GitHub stacked PRs via the `gh stack` extension (`gh extension install github/gh-stack`,
needs `gh` ≥ 2.0). **This is the expected shape for work that splits into layers** — a `tools/`
change plus the skills consuming it, a refactor plus the feature built on it, a workflow fix plus
the docs describing it. Each layer gets its own PR whose diff is only that layer, so it can be
reviewed and CI'd alone. A single-layer change is still just `feature/* → dev`; don't stack for
the sake of it.

```sh
gh stack init --base dev feature/first-layer   # --base dev is MANDATORY, see below
# ...commit...
gh stack add feature/second-layer              # ...commit...
gh stack submit                                # pushes all branches, opens the PRs, links the stack
gh stack view                                  # see the stack; `up`/`down`/`top`/`bottom` navigate
```

Four things that actually bite:

- **Always pass `--base dev` to `gh stack init`.** The repo's *default* branch is `main`, and
  `gh stack` roots a stack on the default branch unless told otherwise. Omitting `--base` silently
  builds a stack whose bottom PR targets `main` — a direct violation of the first golden rule.
- **Land a stack with `gh stack merge`, not layer by layer.** Feature → `dev` is squash
  (`shipflow.json` `featureToDevMethod`), which rewrites the bottom layer's commits; merging one
  layer at a time therefore forces a `gh stack sync` before the next layer's diff is clean again.
  `gh stack merge --yes --squash` lands the whole stack all-or-nothing in one squash per layer and
  avoids that entirely. Keeping squash is deliberate — the friction is a merge-order problem, not
  a merge-method problem.
- **Every layer gets its own `ci / <skill>` checks, and none of them are required.** `dev` is
  push-open with zero required checks, so a red layer will still merge. Read the checks; they will
  not stop you. This works only because each caller's `pull_request` trigger lists `feature/**` as
  a base — **a stacked layer's base is the branch below it, not `dev`, so dropping `feature/**`
  from any caller silently gives that skill no checks at all on stacked work.**
- **Cleanup is the existing rule, not a new one.** `delete_branch_on_merge` removes merged layer
  heads on the remote and GitHub auto-retargets the next PR onto `dev`; `gh stack sync --prune`
  clears the locals. Feature branches still get deleted as soon as they merge, local *and* remote.

Stacks never target `main`: promotion stays a single `dev → main` PR, and
`dev-to-main-automerge.yml` guards on `head.ref == 'dev'`, so stacked PRs cannot trip the
promotion or release automation. Stack metadata lives in `.git/gh-stack` and is not committed.

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
   the PR **merges itself once every `ci / <skill>` check passes**. If any check fails, it never
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

> The per-skill `release` job (`needs: ci`) runs on a push to `main` **or** an on-demand
> `workflow_dispatch` (step 6).
>
> **⚠️ A `dev → main` auto-merge DOES fire the push trigger — releases are effectively
> publish-on-merge, not dispatch-gated.** This file previously claimed the bot `GITHUB_TOKEN`
> suppresses push events; that is wrong, and it cost a release. Observed 2026-07-28: PR #94
> auto-merged at 14:37:04, a `push`-triggered `city-report` run started at 14:37:07, and it cut
> `city-report-v0.4.0` at 14:37:32 — before a planned CHANGELOG edit had landed, so the GitHub
> Release carried stale notes. The later `release-dispatch` succeeded but was a **no-op**: the
> `_release` workflow skips when the tag already exists, so it silently could not correct anything.
>
> Consequences to plan around:
> - **Land the CHANGELOG in the same promotion as the version bump.** A follow-up promotion to fix
>   release notes is too late — the tag is already cut from the first one.
> - To *hold* a release, keep the version bump off `main` (open the promotion as a draft), not by
>   withholding the dispatch.
> - To repair notes after the fact: `gh release edit <tag> --notes-file <file>`. Re-cutting instead
>   means deleting a published tag, which is worse.
> - `release-dispatch` remains useful for re-running a failed release or one whose push run was
>   cancelled; treat it as a retry path, not the primary trigger.

## CI architecture (how the gate works)

- One reusable **`_release.yml`** (`workflow_call`) + one caller **`<skill>.yml`** per skill +
  **`tools.yml`** (shared `tools/score_skill.py` scorer) + the shipflow-rendered
  **`dev-to-main-automerge.yml`**.
- Each caller has a **`ci` job** (Tier-1 `tools/score_skill.py` SKILL.md lint + the skill's own
  Tier-2 tests) and a **`release` job** (`needs: ci`, runs only on push to `main`).
- **Why every check always passes on any PR:** the `pull_request` trigger is **un-filtered**, so
  every `ci / <skill>` check reports on every PR — running real tests when that skill changed, and
  short-circuiting to success (via `dorny/paths-filter`) when it didn't. This is what makes the
  required-check set always satisfiable, so a `dev → main` PR can auto-merge no matter which skills
  it touches. **The `push` trigger IS path-filtered** so a skill only releases when its own files
  changed.

## Baseline eval sets (the anti-degradation gate)

Every skill ships a **baseline eval set**: deterministic, offline, $0 checks pinned against
artifacts from *real past runs*. They run inside each skill's existing test suite, so
`ci / <skill>` already gates them — there is no separate workflow and no new required check.

**They are deliberately not LLM-judged.** A CI gate that calls a model costs money, flakes, and
turns every release into a coin flip. The LLM-judged harnesses (`evals/run_eval.py`,
`voice_judge.py`, `judge_post.mjs`, `scripts/evals/run.mjs`) stay **manual and cost-capped** — run
them when adding a feature, not to merge. Anything in CI is offline and cannot spend.

Four rules keep these catching real degradation instead of becoming release friction:

1. **Two-sided.** Every baseline asserts good-input-passes **and** known-bad-input-fails. A
   one-sided baseline silently rots the day someone weakens the checker.
2. **Anti-vacuity floors.** Any corpus-driven check declares `min_corpus`. A glob that quietly
   matches nothing must go red, not green. (This is the most common way a baseline turns
   decorative — it bit this very change during development: a `r.errors ?? []` typo against a
   `{ok, findings}` return made 61 devlog entries report "all clean" while checking nothing.)
3. **Floors, not equality, for scores.** Byte-exactness is used in exactly two places — shipflow's
   rendered workflow and press's emitted regions — and for the same reason: in both, the generated
   file *is* the contract, so one changed character is a change to shipped behaviour or appearance.
4. **One-command refresh.** Every frozen artifact has an `update_command` in
   `skill-invariants.json`, and the failing assertion prints it.

`skills/<skill>/skills/<skill>/skill-invariants.json` is the declaration: `prose` (guardrails no
code enforces) + `baseline` (each entry naming its `test`, `fixtures`/`corpus_glob`, `min_corpus`
and `update_command`). **`tools/lint_baseline.py` enforces the declaration is real** — it runs
unconditionally in `ci / marketplace` and fails if a skill has no baseline, names a test that does
not exist *or that no test runner discovers*, declares a missing fixture, or has a corpus glob
below its own floor.

| Skill | Baseline pinned against | Catches |
|---|---|---|
| ghostwriter / -x | 31 / 6 published, user-approved drafts | voice lint drifting into false positives or missing known AI tells; X 280-weighted-length regressions |
| shipflow | this repo's own `shipflow.json` → rendered workflow (+ its `renderedTemplateHashes` receipt) | any renderer/config-mapping drift; found a real bug on first run (see below) |
| city-report | two real cached city bundles (small places, where the `_1` cubes fail first) | a section or headline metric silently vanishing; the Data USA "HTTP 200 + zero rows" trap |
| github-stats | a stubbed-`gh` end-to-end `overview` golden | assembly regressions the per-function unit tests cannot see |
| resume | a real tailored résumé × 28 real job postings | JD-keyword coverage ceasing to discriminate — i.e. every eval score becoming meaningless while still looking like a number |
| devlog | 8 entries actually published to natejswenson.io | a lint rule growing strict enough to reject work a human already shipped |
| press | every brand value as it existed in 8 files across 4 repos *before* press generated any of them | a token edit silently changing a colour a shipped product depends on; a generated region drifting or vanishing |
| forge | the good/broken workflow pair the ladder was developed against, plus a byte-exact masthead | a rung silently ceasing to catch its defect class; the emitted masthead drifting; `collectUses` matching nothing and reporting "all clean" over zero actions |
| assay | a real graded run — this repo's own smith session, frozen as a normalized trace, scored against smith's frozen contract; plus every shipped skill's frozen contract as a corpus | the probe catalogue silently ceasing to fire; clause extraction dropping a rule form so the report shrinks while still looking complete; `case` accepting an eval that passes on arrival; a contract resolver matching nothing and grading an empty rubric as clean |
| smith | a real `scaffold` run of the `tally` demo spec (re-run and byte-compared, not just diffed), a spec that must be rejected, this repo's own 11 shipped skills as a conformance corpus, and their 11 READMEs as a house-style corpus | the scaffolder drifting a byte; a wiring point silently dropping out of the plan; `check-spec` weakening until it accepts a spec that produces a skill which never triggers; the conformance or README resolver matching nothing and calling it "all conformant" |
| pluginsync | a real run — this machine's actual `claude plugin list --json` against this repo's actual plugin versions, frozen and byte-compared; plus a marketplace whose source has no `plugin.json`, and the live repo's plugin set as a corpus | the report's columns, action classification or restart footer drifting; an unreadable source being dropped instead of reported, so a partially-read marketplace renders as "everything matches"; the resolver matching nothing and calling an empty table up to date |

> The devlog corpus is a **curated** subset on purpose: only 17 of 61 published entries satisfy
> today's contract, the rest predating rules that landed later. Asserting over all 61 would encode
> "the linter must accept its own history", which is a different and wrong requirement.

## The brand is generated, never copied

`skills/press/skills/press/brand/tokens.json` is the **only** place a brand value is written
down — colours, the terminal-panel palette, font stacks, the monogram. Since press 0.8.0
that includes the masthead every forge-generated GitHub Actions workflow wears, via the
`yaml` region syntax and the `gha-header` emitter. Every consumer receives
those values in a **generated region** spliced into an otherwise hand-written file:

```
# >>> press:tokens v0.1.0 sha256:… GENERATED by @natjswenson/press, do not edit
...
# <<< press:tokens
```

- **Never hand-edit a region.** Edit `tokens.json` (or the target's `params` in
  `skills/press/skills/press/targets.json`) and re-run
  `node skills/press/skills/press/bin/press.js emit`.
- **Never generate a whole file.** The region owns the token block; the consumer owns its
  stylesheet, its poster geometry, its personal footer. A whole-file sync clobbered
  ghostwriter's personal avatar footer once already.
- **A new consumer means a new `targets.json` entry**, not a copied hex. Before press, this
  brand existed as eight hand-ported copies across four repos with five different names for
  the same orange, and three genuinely-shared token groups declared nowhere at all.

**Two gates, deliberately overlapping.** `ci / press` runs `press check` over every target
whenever press *or any file it writes into* changes; each consumer's own `ci / <skill>` job
also runs `press check --target <id>` for just its region. The second is what makes drift fail
in the PR that causes it, instead of whenever someone next happens to touch press.

Outside this repo (`budget`, `local-fitness`, `natejswenson.io`) the same registry applies —
those targets are already declared and resolve only inside their own checkout. Run
`npx -y @natjswenson/press@latest check --repo .` there. **Always pin `@latest`**, for the same
reason documented for shipflow above: a bare `npx` silently prefers a stale global install.

## The README house style

Every skill's `README.md` follows one shape: **fixed head, free tail, fixed foot**. The spec is
`skills/smith/skills/smith/references/readme.md`; `gradeReadme`
(`skills/smith/skills/smith/scripts/lib/readme.mjs`) checks it; `smith verify` reports it as the
house-tier `readme-structure` check.

```
# <name>                     ← line 1, the bare skill name and nothing else
<press:masthead region>      ← GENERATED by press, never typed
*standfirst*                 ← one italic line
> **the one rule**           ← the pull quote
## Why install this / What you get / Quick start / Triggers / Requirements
    … anything this skill needs, in any order …
## Development / Changelog / License
```

Three things that bite:

- **The H1 must be exactly `# <name>`.** press's `<name>-readme` target anchors its masthead on
  `^# <name>$`. A decorated title does not error — it *detaches* the region, and the next
  `press emit --init` splices a second masthead below the first.
- **The gate lives in `ci / marketplace`**, which runs `smith verify --all` unconditionally, for
  the same reason `lint_baseline.py` does: a README edited in *some other skill's* PR would never
  be graded by a path-filtered check, which is how a house style rots one PR at a time.
- **The tail is free on purpose.** devlog's configuration reference and ghostwriter's compliance
  notes are real content no five-section template has room for. Order is enforced only on the head
  and the foot.

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
- `main` required checks — **one per skill, no exceptions**: `ci / devlog`, `ci / resume`,
  `ci / ghostwriter`, `ci / ghostwriter-x`, `ci / github-stats`, `ci / shipflow`,
  `ci / city-report`, `ci / press`, `ci / forge`, `ci / smith`, `ci / assay`, `ci / pluginsync`. These names are the job `name:` values — **renaming a caller or its `ci`
  job silently un-requires it; update branch protection in the same change.**
  `ci / marketplace` is deliberately NOT required yet (see `marketplace.yml`'s header).
  To audit for drift — a skill whose CI runs but does not gate `main`:
  ```bash
  req=$(gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.contexts[]' | sed 's|ci / ||')
  for s in $(ls .github/workflows/*.yml | sed 's|.*/||;s|\.yml||' | grep -v '^_\|automerge\|tools\|marketplace\|propagate'); do
    echo "$req" | grep -qx "$s" || echo "NOT REQUIRED: ci / $s"
  done
  ```
  (`ci / shipflow` was missing this way from its introduction until 2026-07-28 — its CI ran and
  reported on every PR, but a promotion could auto-merge with it red.)
  The filter excludes `press-propagate` too: it has only a `propagate` job and no `ci` job, so it
  can never satisfy a required check. Without that exclusion the audit reports it as drift on every
  run, and an audit that always cries wolf stops being read.

**Bootstrap note:** `dev-to-main-automerge.yml` is a plain `pull_request`-triggered workflow (not
`pull_request_target`), so unlike the auto-merge workflow it replaced, it needs **no manual-merge
bootstrap** — GitHub evaluates `pull_request` workflows from the PR's merge ref, so the file fires
correctly on the very first `dev → main` PR that introduces it, as long as it already exists on
`dev` (the head).

## Adding a new skill

> **Use `/smith` instead of doing this by hand.** `smith scaffold` applies steps
> 1–8 below as one all-or-nothing change (and reads the action SHAs out of the
> callers this repo already ships, rather than copying a stale pin), then
> `smith verify --skill <name>` reports which rung it reached. The list below is
> what smith does, kept here because it is the specification smith is checked
> against — `ci / smith` fails if the two drift apart.
>
> Two things smith writes but **cannot apply**: `.github/repo-settings.sh` only
> takes effect when an admin runs it, and the baseline-eval table row above is
> prose. And step 10 is deliberately not automated past the declaration —
> `smith freeze` requires a real run, and the scaffolded `baseline.test.mjs`
> **fails** until it gets one. Step 11's masthead is likewise a separate
> `press emit --init`: the brand is generated, so the scaffolder registers the
> target but never writes the region itself.

1. Copy a caller `<skill>.yml`. **Keep the `pull_request` trigger un-filtered** and **keep the `ci`
   job's `permissions: { contents: read, pull-requests: read }`** — both are load-bearing
   (`pull-requests: read` lets `dorny/paths-filter` detect changes under the restricted default
   token; dropping it red-lines the required check on every PR).
2. Path-filter only the `push` trigger to `skills/<skill>/**` (+ `tools/score_skill.py` +
   `tools/lint_plugin.py` + the caller).
3. Set the release call `with: { skill: <skill> }` (+ `version-source` if not auto-detectable).
4. Ensure the skill has `CHANGELOG.md` and a version (package.json or SKILL.md frontmatter).
5. **Add `ci / <skill>` to `main`'s required checks** — edit `.github/repo-settings.sh`
   **and run it**; editing alone applies nothing. Then verify with the drift audit in
   Repo settings, below. A caller that exists but isn't required is invisible: it goes
   green on PRs and gates nothing.
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
10. **Add `skill-invariants.json` with both a `prose` and a `baseline` block, and the tests that
    enforce them** (see Baseline eval sets, above). `ci / marketplace` runs
    `tools/lint_baseline.py` unconditionally and **fails the PR** if the new skill has no baseline,
    names a test no runner discovers, or declares a fixture/corpus that isn't there — so this is
    not optional and cannot be deferred. Put the baseline test where the skill's runner already
    looks (`tests/test_*.py` for pytest skills, `tests/**/*.test.mjs` or `scripts/**/*.test.mjs`
    for node skills); no CI wiring is needed beyond that. Pin it against a **real past run** of the
    skill, not a synthetic fixture — that is the whole point.
11. **Write `README.md` in the house style and splice its masthead** (see The README house style,
    above). `smith scaffold` writes a conforming README; `press emit --init --target <skill>-readme`
    adds the brand region, which the scaffolded README deliberately lacks until then. `ci /
    marketplace` runs `smith verify --all` unconditionally, so a README that misses the shape
    fails the PR.

## Design docs

- `docs/plans/2026-06-19-repo-cicd-reusable-workflows-design.md` — the reusable-CI + per-skill-test design.
- `docs/plans/2026-06-25-dev-to-main-auto-merge.md` — the `dev → main` auto-merge design.
- `docs/plans/2026-07-10-marketplace-plugin-topology-design.md` — the plugin-marketplace topology
  design (plugin.json/marketplace.json, the two new lint scripts, `ci / marketplace`).
