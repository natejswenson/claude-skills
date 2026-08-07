# The anatomy of a release run

Four stages. Each one proves something different, and only the last one proves a
release happened.

| Stage | Command | Proves | Does NOT prove |
|---|---|---|---|
| Preflight | `release preflight` | what is on main, what is tagged, what is unreleased, what blocks it, and who else rides along | that any of it is *worth* releasing |
| Notes | `release changelog-draft` → your prose → `release prepare` | the version and the entry exist in one commit on a branch | that anything is pushed |
| Cut | `release cut` (repeatedly) | the branch reached dev, the promotion reached main | that a tag was cut |
| Proof | `release cut` returning `done: true` | **the tag exists on origin** | — |

## What may never be reported as a release

Every one of these can succeed while no tag is ever cut:

- **A dispatched workflow.** `gh workflow run` exits 0 as soon as GitHub accepts
  the request. The run itself can fail a minute later.
- **A merged promotion.** Merging into `main` does not trigger a release at all —
  the release jobs are `workflow_dispatch`-only. It only moves the version there.
- **A green check.** `ci / <name>` passing means the tests passed, not that
  `release` ran — the release job is a separate job with its own conditions.
- **A `_release.yml` run that succeeded.** It deliberately no-ops when the tag
  already exists. A "successful" re-run can therefore have corrected nothing,
  which is exactly how a release once shipped with stale notes and the retry
  silently fixed neither the tag nor the notes.

The tag, fetched back from origin with `git ls-remote`, is the only evidence.

## The states, and why each exists

- **`clean`** — the version on main equals the last tag. The common case. Needs a
  bump, notes, and the full path.
- **`untagged-bump-on-main`** — the version on main is *higher* than the last tag.
  Something already bumped it and no tag was cut: a cancelled push run, a failed
  release job, or a version bump that landed as ordinary feature work. **No PR is
  needed.** Dispatching the existing workflow is enough, because the file on main
  already carries the version the tag will take.
- **`bump-on-dev-unpromoted`** — the bump is sitting on dev. Only a promotion is
  missing.
- **`version-behind-tag`** — main carries a *lower* version than a tag that
  already exists. This means a tag was cut from something other than main. There
  is no safe automatic recovery; stop and ask.

## Collateral, and why it is still worth saying

A `dev → main` promotion is a single merge of the entire `dev` branch. It cannot
be made selective. So every component sitting on dev with a version that has no
tag has its bump moved to `main` by the same promotion.

**It is not released by that.** Every caller's release job is
`workflow_dispatch`-only, and `cut` dispatches exactly one named component. A
merge tags nothing; each collateral component simply becomes
`untagged-bump-on-main` and can be released later, deliberately.

This was not always true, and the history is the reason the rule exists. Until
2026-08-02 the release jobs also ran on `push`, so a promotion tagged and
npm-published every bumped component within seconds of merging — irreversibly, to
a registry that does not allow re-publishing a version. Two releases went out
that way before it was changed.

So the disclosure stays, with a smaller claim behind it: the user should know
what their promotion moves to `main`, and which components are now one dispatch
away from a release nobody asked for.

## The 0.x cap

Conventional-commit tooling maps a breaking change to a major bump. For a
component still on `0.x`, that means silently declaring `1.0.0` — a public promise
about API stability.

`suggestedBump` caps this at `minor` and sets `suggestedBumpCapped: true`. Offer
the major bump; never take it. The maintainer decides when something is 1.0.
