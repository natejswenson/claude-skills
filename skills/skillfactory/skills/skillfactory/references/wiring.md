# wiring — the eight registries, and what breaks when one is missed

A skill is not one directory. It is one directory plus eight entries elsewhere,
and **every one of them fails silently.** Nothing goes red; the skill simply is
not there, in a way that looks exactly like being there.

| # | Registry | Missing means | Applied by |
|---|---|---|---|
| 1 | `.claude-plugin/marketplace.json` | nobody can install it; `lint_marketplace.py` fails the PR | `scaffold` |
| 2 | `.github/workflows/<name>.yml` | no `ci / <name>` check exists at all | `scaffold` |
| 3 | `.github/repo-settings.sh` `contexts` | CI runs, reports green, and gates nothing on `main` | `scaffold` **+ an admin run** |
| 4 | press `targets.json` | `press check` cannot see the skill; brand drift is invisible | `scaffold`, then `press emit --init`, then the golden refresh |
| 5 | root `README.md` — table, install block, symlink block | the skill is undiscoverable to a reader | `scaffold` |
| 6 | `CLAUDE.md` required-check list | the drift audit is read against a list that is now wrong | `scaffold` |
| 7 | `.github/shipflow.json` `release.components` | the skill can never be released; `ci / release` fails the PR | `scaffold` |
| 8 | `CLAUDE.md` baseline-eval table | the anti-degradation contract has a hole nobody can see | **the agent** — it is prose |

## The one that has actually bitten

`ci / shipflow` ran on every PR and gated nothing on `main` from the day it was
introduced until a drift audit happened to be run months later. The caller
existed, the job was green, the check was simply never added to the contexts
array. That is registry 3, and it is the one that cannot be verified from inside
the repo — the file says the right thing and GitHub does not.

**Editing `.github/repo-settings.sh` applies nothing.** An admin has to run it.
Say so, out loud, every time.

Audit for it:

```bash
req=$(gh api repos/<owner>/<repo>/branches/main/protection \
  --jq '.required_status_checks.contexts[]' | sed 's|ci / ||')
for s in $(ls .github/workflows/*.yml | sed 's|.*/||;s|\.yml||' \
  | grep -v '^_\|automerge\|tools\|marketplace\|propagate'); do
  echo "$req" | grep -qx "$s" || echo "NOT REQUIRED: ci / $s"
done
```

## Registry 4 has a second half

press pins **one golden per target**, so adding two targets makes `ci / press`
red until its fixture set is regenerated:

```bash
node skills/press/skills/press/tests/fixtures/update-pre-migration.mjs
```

That is the design working, not a nuisance: press's golden set is what stops a
brand value drifting, and a set that silently ignores unknown targets would stop
covering the newest consumer first. Run it in the same PR that adds the targets.

## Two properties of the caller that are load-bearing

- **The `pull_request` trigger is un-filtered.** Every `ci / <skill>` check
  reports on every PR — running real tests when that skill changed, and
  short-circuiting to success via `dorny/paths-filter` when it did not. This is
  what makes the required-check set always satisfiable, so a `dev → main`
  promotion can auto-merge no matter which skills it touched. Path-filtering it
  makes the check *pending forever* on unrelated PRs, which blocks every merge.
- **`permissions: pull-requests: read`** is what lets `paths-filter` see changes
  under the restricted default token. Dropping it red-lines the required check on
  every PR.

The `push` trigger *is* path-filtered, so a skill's `ci` job only re-runs on
`main` when its own files changed. It no longer triggers anything else — see
below.

## Naming is a contract

`plugin.json.name` == the directory name == `SKILL.md` frontmatter `name:` ==
the `ci / <name>` job name == the `<name>-v<version>` tag prefix. It is **never**
sourced from `package.json.name` (scoped npm names, and python skills have none).

Renaming a caller or its `ci` job silently un-requires the check. Update branch
protection in the same change.

## A merge cuts nothing — a dispatch does

**This reversed on 2026-08-02, and a scaffolder that predates the change is how
the old behaviour comes back.**

Every caller's `release` job is `workflow_dispatch`-only:

```yaml
if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'
```

**Never generate `push` into that condition.** Release jobs used to run on push
to `main` as well, and a `dev → main` auto-merge *does* fire push events — so
promotions were effectively publish-on-merge. It cost two releases: `city-report`
v0.4.0 tagged with stale notes before a planned CHANGELOG edit landed, and
`shipflow` v0.4.0 tagged *and published to npm* seconds after a merge, with no
dispatch and no decision.

`ci / release`'s corpus baseline asserts this across every caller in the repo, so
a template that regresses fails the PR rather than the next release. It caught
exactly that in `issueflow`'s first PR.

Two consequences that survive the change:

- **The version bump and the `CHANGELOG.md` entry still land in the same commit.**
  `_release.yml` reads the notes off whatever is on `main` at dispatch time and
  skips a tag that already exists, so notes arriving later are notes the release
  will never carry.
- **To hold a release, simply do not dispatch.** A bump can sit on `main` as
  `untagged-bump-on-main` indefinitely; that is a normal, safe state, not a
  problem to clear.
