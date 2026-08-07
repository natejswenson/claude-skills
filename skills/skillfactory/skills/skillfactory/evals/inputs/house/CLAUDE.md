# CLAUDE.md (fixture house)

The one line a scaffold run edits here: the required-check list, which has to
stay identical to the `contexts` array in `.github/repo-settings.sh`. skillfactory
anchors on the last context that script declares rather than on a remembered
skill name, which is what keeps the two lists from drifting apart.

## Repo settings (as code)

`main` required checks — **one per skill, no exceptions**: `ci / press`.
These names are the job `name:` values — renaming a caller or its `ci` job
silently un-requires it; update branch protection in the same change.
