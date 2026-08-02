# wiring — the seven registries, and what breaks when one is missed

A skill is not one directory. It is one directory plus seven entries elsewhere,
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
| 7 | `CLAUDE.md` baseline-eval table | the anti-degradation contract has a hole nobody can see | **the agent** — it is prose |

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

The `push` trigger *is* path-filtered, so a skill only releases when its own
files changed.

## Naming is a contract

`plugin.json.name` == the directory name == `SKILL.md` frontmatter `name:` ==
the `ci / <name>` job name == the `<name>-v<version>` tag prefix. It is **never**
sourced from `package.json.name` (scoped npm names, and python skills have none).

Renaming a caller or its `ci` job silently un-requires the check. Update branch
protection in the same change.

## Releases are publish-on-merge

A `dev → main` auto-merge fires the push trigger and cuts the tag immediately.
The version bump and the `CHANGELOG.md` entry must land in the **same**
promotion — a follow-up to fix release notes is too late, because the tag and
its notes are already published. To hold a release, keep the version bump off
`main`, not the dispatch.
