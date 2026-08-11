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
- **A merge never cuts a tag. `/release` does.** Every per-skill `release` job is
  `workflow_dispatch`-only, so promoting `dev → main` moves a version bump to `main` and stops
  there. The tag is cut when — and only when — that skill's workflow is dispatched, which is what
  the `release` skill does after the promotion lands. **Never add `push` back to a release job's
  `if:`** (see the release-process section for the two releases that cost).
  Releasing still requires the version bumped (`package.json` for node skills, `SKILL.md`
  frontmatter `version:` for python skills, **and** `plugin.json.version` in
  `skills/<skill>/.claude-plugin/plugin.json` for all skills — the Tier-1.5 lint fails the PR if it
  diverges) **and** a `CHANGELOG.md` entry in the same change, since `_release.yml` reads the notes
  off `main` at dispatch time.
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

> **Use `/release <skill>` instead of doing this by hand.** Since `release` 0.1.0 the whole
> path below is one flow: `release preflight` reads what's on main and what's unreleased,
> `release changelog-draft` groups the commits, and `release cut` drives the bump through
> `feature/* → dev → main` and does not report success until the tag is fetched back from
> origin. The steps below are the specification it implements, kept here because they are
> what the skill is checked against — and because steps 3–6 are still the manual fallback.
>
> Two things `/release` surfaces that the manual path silently does not:
> **collateral** (a promotion is atomic and carries all of `dev`, so releasing one skill
> releases every other bumped-but-untagged one — the list is named before the irreversible
> step), and the **0.x cap** (a breaking change is held at minor rather than silently
> declaring 1.0.0).
>
> **Every component must be declared** in `.github/shipflow.json`'s `release.components`.
> `ci / release`'s corpus baseline fails if a directory under `skills/` is missing from it,
> so a new skill cannot quietly become invisible to the release flow.

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
   **`package-lock.json` is one of those fields too** (both its root `version` and its
   `packages[""].version`), so a node skill's bump must touch the lockfile as well —
   `npm install` does it for free. It went unchecked until 2026-08-02, by which point five
   skills had drifted (shipflow's lockfile said 0.2.4 against a 0.5.0 package). It matters
   because `npm pack`/`npm publish` read the lockfile into the tarball, so the wrong version
   ships to the registry. A skill with **no dependencies** correctly has no lockfile, and its
   absence is never an error.
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

> **The per-skill `release` job (`needs: ci`) runs on `workflow_dispatch` and nothing else.**
> A push to `main` runs that skill's `ci` job and cuts nothing. **A dispatch is the only way a
> tag is ever created in this repo**, and `/release` is the thing that dispatches it.
>
> **This changed on 2026-08-02, and the history is why the rule is absolute.** The release jobs
> used to run on `push` to `main` as well, and a `dev → main` auto-merge *does* fire push events —
> so promotions were effectively publish-on-merge. It cost two releases:
> - **2026-07-28:** PR #94 auto-merged at 14:37:04; a `push`-triggered `city-report` run started
>   at 14:37:07 and cut `city-report-v0.4.0` at 14:37:32, before a planned CHANGELOG edit had
>   landed, so the GitHub Release carried stale notes. The later `release-dispatch` succeeded but
>   was a **no-op** — `_release` skips an existing tag, so it silently corrected nothing.
> - **2026-08-02:** PR #159 merged at 19:34:55 and `shipflow-v0.4.0` was tagged *and published to
>   npm* seconds later, with no dispatch and no decision.
>
> Consequences to plan around, under the current (dispatch-only) rule:
> - **Land the CHANGELOG in the same change as the version bump.** `_release.yml` reads the notes
>   off whatever is on `main` when the dispatch happens, and skips a tag that already exists — so
>   notes arriving later are notes the release will never carry, and no retry fixes it.
> - To *hold* a release, simply do not dispatch. The bump can sit on `main` as
>   `untagged-bump-on-main` indefinitely; that is a normal, safe state.
> - To repair notes after the fact: `gh release edit <tag> --notes-file <file>`. Re-cutting instead
>   means deleting a published tag, which is worse.
> - **Never re-add `push` to a release job's `if:`.** Every caller carries a comment saying so.
>   Removing the gate without also removing `release-cut`'s dispatch would double-release; removing
>   the dispatch without the gate brings back publish-on-merge.

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
| shipflow (component releases) | covered by `release`'s baseline, which pins **shipflow's own `release-status` output**, plus 23 unit tests that drive a real git repo rather than a mock | a component resolving to the wrong files; `prepare` sweeping unrelated dirty work into a release commit; the `{name}` validator admitting a traversal. Deliberately **not** a second frozen corpus in `ci / shipflow` — it would pin the same artifact twice |
| city-report | two real cached city bundles (small places, where the `_1` cubes fail first) | a section or headline metric silently vanishing; the Data USA "HTTP 200 + zero rows" trap |
| github-stats | a stubbed-`gh` end-to-end `overview` golden | assembly regressions the per-function unit tests cannot see |
| resume | a real tailored résumé × 28 real job postings | JD-keyword coverage ceasing to discriminate — i.e. every eval score becoming meaningless while still looking like a number |
| devlog | 8 entries actually published to natejswenson.io | a lint rule growing strict enough to reject work a human already shipped |
| press | every brand value as it existed in 8 files across 4 repos *before* press generated any of them | a token edit silently changing a colour a shipped product depends on; a generated region drifting or vanishing |
| ghfactory | the good/broken workflow pair the ladder was developed against, plus a byte-exact masthead | a rung silently ceasing to catch its defect class; the emitted masthead drifting; `collectUses` matching nothing and reporting "all clean" over zero actions |
| eval | a real graded run — this repo's own skillfactory session, frozen as a normalized trace, scored against skillfactory's frozen contract; plus every shipped skill's frozen contract as a corpus | the probe catalogue silently ceasing to fire; clause extraction dropping a rule form so the report shrinks while still looking complete; `case` accepting an eval that passes on arrival; a contract resolver matching nothing and grading an empty rubric as clean |
| skillfactory | a real `scaffold` run of the `repocount` demo spec (re-run and byte-compared, not just diffed), a spec that must be rejected, this repo's own 11 shipped skills as a conformance corpus, and their 11 READMEs as a house-style corpus | the scaffolder drifting a byte; a wiring point silently dropping out of the plan; `check-spec` weakening until it accepts a spec that produces a skill which never triggers; the conformance or README resolver matching nothing and calling it "all conformant" |
| release | real `shipflow release-status` output for three components spanning many/one/zero unreleased commits, with the rendered CHANGELOG draft re-run and byte-compared; plus every skill in the repo as a component corpus | the draft grouper silently dropping a commit while still emitting a complete-looking entry; `cut` proceeding without its TOCTOU hash; a fixture refresh collapsing every input to "nothing to release" so the golden passes over nothing; a newly-shipped skill never being declared in `release.components`, so `preflight` reports on 12 of 13 and looks complete |
| pluginsync | a real run — this machine's actual `claude plugin list --json` against this repo's actual plugin versions, frozen and byte-compared; plus a marketplace whose source has no `plugin.json`, and the live repo's plugin set as a corpus | the report's columns, action classification or restart footer drifting; an unreadable source being dropped instead of reported, so a partially-read marketplace renders as "everything matches"; the resolver matching nothing and calling an empty table up to date |
| shipreport | a real week of this account's own contributions and sessions — 549 contribution records and 124 session digests, frozen and field-projected, with `rank`, `receipts` and the rendered sheet re-run and byte-compared; plus a draft whose only defect is one citation that names a commit not in the corpus | the ranking silently reordering or dropping an item while still emitting a complete-looking report; the receipts gate weakening until a claim with no artifact behind it reaches the sheet; a fixture refresh collapsing the corpus to a handful of items so the golden passes over almost nothing; a session digest carrying prompt text into a public repo |
| issueflow | a real run against `natejswenson/local-fitness#133` — its real issue list and payload, plus the investigation and design a real opus subagent wrote from the briefs this skill rendered, re-run and byte-compared; a run whose only defect is a missing approval; the four shipped stage contracts as a corpus | a stage brief silently ceasing to carry the artifact it inherits, so a subagent starts blind on work already done — invisible at the call site; a stage changing model, which changes what every run costs and how good it is; the gate weakening until a stage advances on unapproved input, or `ship` opening a PR over one; a fixture refresh collapsing every issue to one `Detail` value so the board passes over a signal that no longer discriminates |
| gmailtriage | an **invented** mailbox reproducing the shape of three real runs — a 66-thread triage, a `Recruiting` folder split into four sub-labels (two reachable only through an applicant-tracking vendor), and a label cleanup frozen before (9 unmanaged folders, a transposed duplicate pair, 14 unclaimed threads) and after (100%, clean, exit 0) — with every command re-run and byte-compared, plus a retroactive re-plan that must take **zero**. The corpus is generated, never redacted from a mailbox: pseudonymised senders still leak whose life it is | a sub-label rule ceasing to apply its parent; a cluster auto-named after the vendor hosting it rather than the organisation; a broad rule in front of one filing into a sub-label of it, which does not fail but splits the mailbox by arrival time; a retroactive pass ceasing to converge; the audit answering `plan`'s question instead of its own, which reported 47 of 48 correctly-filed threads as unclaimed; the clean state ceasing to be reachable, so the gate could never be satisfied; a merge unlabelling before it labels; and a real sender domain or organisation reaching the corpus at all |
| skillhelp | a real `build` over a **frozen snapshot** of six real shipped skills — chosen to span python skills, node skills declaring a `split`, the older heading vocabulary six skills still use, and skillhelp itself — re-run and byte-compared card for card; plus a drift trap that must exit non-zero, and the live repo's cards as a corpus with a floor of 12 | an extractor silently dropping a section so a card still looks complete while answering nothing; a fact losing its `file:line`, which makes every answer built on it ungrounded; the drift gate weakening until a stale card answers confidently, **and** the opposite — reddening on edits that change no answer, which is how a gate stops being read; a bonus lifting a fact over the retrieval floor, which made "what is the retry limit in gmailtriage" return five confident irrelevant facts instead of the not-documented block; a secret pasted into a skill's markdown reaching a committed, public index; and a snapshot refresh silently copying zero files so the golden passes over nothing |
| brandreport | a real blind-discovery run on the maintainer's own name — 7 confirmed artifacts (site, GitHub, npm, LinkedIn, X, the published book) kept as fetched, every same-name stranger replaced by an invented `.example`-domain stand-in (gmailtriage precedent), with `gate` + `report` re-run over the frozen corpus and the report byte-compared; plus a findings file whose only defects are a dangling citation and an unconfirmed item cited as confirmed, which must fail the gate | the renderer drifting or silently dropping a section while the report still looks complete; provenance ceasing to thread from claim to snapshot; the attribution gate weakening until unverified content is attributed — the one rule ceasing to be code; and a corpus refresh leaking a real same-name person's identity into a public repo, caught structurally (unconfirmed snapshots must live on `.example` domains) without committing a blocklist of real identities |

> **skillhelp's golden is pinned against a snapshot, not `skills/`, on purpose.** A
> byte-compared build over the live tree would redden on every edit to any of
> seventeen skills — a toll booth on every PR in the repo, and a baseline people
> delete rather than maintain. Pinning the input means the golden moves only when
> the *extractor* moves. Live coverage is `skillhelp check`'s job, which is why
> `ci / skillhelp` is the one caller whose paths-filter matches `skills/**`
> rather than its own directory: its cards describe the other skills, so
> filtering it the usual way would short-circuit the job to green on exactly the
> PR that made the index stale.

> The devlog corpus is a **curated** subset on purpose: only 17 of 61 published entries satisfy
> today's contract, the rest predating rules that landed later. Asserting over all 61 would encode
> "the linter must accept its own history", which is a different and wrong requirement.

## The brand is generated, never copied

`skills/press/skills/press/brand/tokens.json` is the **only** place a brand value is written
down — colours, the terminal-panel palette, font stacks, the monogram. Since press 0.8.0
that includes the masthead every ghfactory-generated GitHub Actions workflow wears, via the
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
`skills/skillfactory/skills/skillfactory/references/readme.md`; `gradeReadme`
(`skills/skillfactory/skills/skillfactory/scripts/lib/readme.mjs`) checks it; `skillfactory verify` reports it as the
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
- **The gate lives in `ci / marketplace`**, which runs `skillfactory verify --all` unconditionally, for
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
  `ci / city-report`, `ci / press`, `ci / ghfactory`, `ci / skillfactory`, `ci / eval`, `ci / release`,
  `ci / pluginsync`, `ci / issueflow`, `ci / shipreport`, `ci / gmailtriage`, `ci / skillhelp`, `ci / brandreport`. These names are the job `name:` values — **renaming a caller or its `ci`
  job silently un-requires it; update branch protection in the same change.**
  `ci / marketplace` is deliberately NOT required yet (see `marketplace.yml`'s header).
  To audit for drift — a skill whose CI runs but does not gate `main`:
  ```bash
  req=$(gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.contexts[]' | sed 's|ci / ||')
  for s in $(ls .github/workflows/*.yml | sed 's|.*/||;s|\.yml||' | grep -v '^_\|automerge\|tools\|marketplace\|propagate\|security'); do
    echo "$req" | grep -qx "$s" || echo "NOT REQUIRED: ci / $s"
  done
  ```
  (`ci / shipflow` was missing this way from its introduction until 2026-07-28 — its CI ran and
  reported on every PR, but a promotion could auto-merge with it red.)
  The filter excludes `press-propagate` and `security` too: `press-propagate` has only a
  `propagate` job, and `security.yml`'s four jobs are all named `security / <job>` — neither has a
  `ci` job, so neither can ever satisfy a required check. Without those exclusions the audit
  reports them as drift on every run, and an audit that always cries wolf stops being read.
  (`security` was missing from this list until 2026-08-02, found by actually running the audit
  after adding `ci / release` — the snippet predates `security.yml`.)

**Bootstrap note:** `dev-to-main-automerge.yml` is a plain `pull_request`-triggered workflow (not
`pull_request_target`), so unlike the auto-merge workflow it replaced, it needs **no manual-merge
bootstrap** — GitHub evaluates `pull_request` workflows from the PR's merge ref, so the file fires
correctly on the very first `dev → main` PR that introduces it, as long as it already exists on
`dev` (the head).

## Adding a new skill

> **Use `/skillfactory` instead of doing this by hand.** `skillfactory scaffold` applies steps
> 1–8 below as one all-or-nothing change (and reads the action SHAs out of the
> callers this repo already ships, rather than copying a stale pin), then
> `skillfactory verify --skill <name>` reports which rung it reached. The list below is
> what skillfactory does, kept here because it is the specification skillfactory is checked
> against — `ci / skillfactory` fails if the two drift apart.
>
> Two things skillfactory writes but **cannot apply**: `.github/repo-settings.sh` only
> takes effect when an admin runs it, and the baseline-eval table row above is
> prose. And step 10 is deliberately not automated past the declaration —
> `skillfactory freeze` requires a real run, and the scaffolded `baseline.test.mjs`
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
7b. **Declare the skill in `.github/shipflow.json`'s `release.components`** (kept sorted).
   Without it the skill can never be released — `release preflight` reports on every *other*
   component and looks complete — and `ci / release`'s corpus baseline fails the PR.
   `skillfactory scaffold` applies this since 0.4.0; before then it did not, which is how
   `issueflow` reached its first PR undeclared.
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

    **The one exception is a corpus that is somebody's private life.** `gmailtriage` pins the
    *shape* of a real run — cluster sizes, which senders trip which guard, a folder spelled two
    ways — reproduced by a committed generator, because the fixtures are otherwise a real mailbox.
    Redacting one is not enough: with every sender pseudonymised, the public repo still showed
    which bank, which health system, which school district and which employer the owner had
    applied to. If a skill's corpus would carry that, invent it and pin the shape, and add a test
    that fails when a real identifier appears (`skills/gmailtriage/skills/gmailtriage/scripts/tests/no-real-data.test.mjs`).
11. **Write `README.md` in the house style and splice its masthead** (see The README house style,
    above). `skillfactory scaffold` writes a conforming README; `press emit --init --target <skill>-readme`
    adds the brand region, which the scaffolded README deliberately lacks until then. `ci /
    marketplace` runs `skillfactory verify --all` unconditionally, so a README that misses the shape
    fails the PR.

## Design docs

- `docs/plans/2026-06-19-repo-cicd-reusable-workflows-design.md` — the reusable-CI + per-skill-test design.
- `docs/plans/2026-06-25-dev-to-main-auto-merge.md` — the `dev → main` auto-merge design.
- `docs/plans/2026-07-10-marketplace-plugin-topology-design.md` — the plugin-marketplace topology
  design (plugin.json/marketplace.json, the two new lint scripts, `ci / marketplace`).
