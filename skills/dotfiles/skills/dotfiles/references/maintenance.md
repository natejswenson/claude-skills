# Maintenance procedures

Resolve `SKILL_DIR`, `DOTFILES_REPO`, `DOTFILES_TARGET` and one `DOTFILES_PACKAGE`
from the loaded skill and user intent. Use absolute paths; quote every argument.
Package values must be manifest names. The examples below work one package at a
time; selected packages can be passed as separate arguments, never shell strings.
Run from the checkout so local Stow policy has a known location. Never run eval
on a report, a manifest field, or simulated output.

## Inspect and edit

```bash
git -C "$DOTFILES_REPO" status --short
node "$SKILL_DIR/scripts/dotfiles.js" inspect --repo "$DOTFILES_REPO" --target "$DOTFILES_TARGET" --package "$DOTFILES_PACKAGE"
```

Read repository instructions. Locate the selected source from the reported
package/path. Edit that source rather than replacing its live symlink. Linked
applications see the edit immediately, so keep changes focused and run the
appropriate parser/syntax check before suggesting restart. Never source shell
files to test them. Review the diff without publishing private values.

For a new config, review its contents for secrets and portability, create the
mirrored path under an existing package (or create a new package and update
`packages.json`), and update repository docs. Do not copy a whole application
folder. Preserve existing shared settings; put machine-specific overrides outside
the checkout. Reinspect the complete allowlist for collisions. A setup request for
an empty location can create this same minimal layout using only requested
packages, plus instructions and tests; do not populate personal defaults.

## Preview and apply

First review the installer source, package file set, `.stowrc`, global/local
ignores and protected exclusions. Confirm none of them enable adoption or change
source, target, folding or selection. Stow's default ignored files can also differ
from the inspector. The relevant GNU Stow manual shipped with the installation
(`info stow` or `man stow`) documents that installation's policy. If policy cannot
be reconciled, stop the link operation and report exactly which paths differ.
Do not remove exclusions simply to get matching output.

When the repository has a reviewed bootstrap matching this contract, use its
preview and links-only modes with explicit target and package:

```bash
cd "$DOTFILES_REPO"
./bootstrap.sh --dry-run --target "$DOTFILES_TARGET" "$DOTFILES_PACKAGE"
./bootstrap.sh --links-only --target "$DOTFILES_TARGET" "$DOTFILES_PACKAGE"
```

Those options are a template, not a claim that every bootstrap supports them.
Check its help/source first. A full bootstrap may install or upgrade dependencies;
it is outside ordinary link maintenance. Missing dependencies need the user's
setup/install scope. Never execute a fetched installer during an audit.

For a repository without a suitable wrapper, after policy reconciliation:

```bash
cd "$DOTFILES_REPO"
stow --dir="$DOTFILES_REPO" --target="$DOTFILES_TARGET" --no-folding --verbose --simulate --restow "$DOTFILES_PACKAGE"
stow --dir="$DOTFILES_REPO" --target="$DOTFILES_TARGET" --no-folding --verbose --restow "$DOTFILES_PACKAGE"
node "$SKILL_DIR/scripts/dotfiles.js" verify --repo "$DOTFILES_REPO" --target "$DOTFILES_TARGET" --package "$DOTFILES_PACKAGE"
```

Read the simulation before applying. Its actual selected file set must match the
intended managed set; add reviewed explicit ignore arguments to **both** commands
if needed. The generic command is unsafe when protected files would still be
linked. Never use `--adopt` or omit `--no-folding`. Reinspect immediately before
application if state changed. This workflow is not atomic against concurrent
application writes: stop and inspect on unexpected results; don't force a retry.

## Conflicts and recovery

A real file, wrong/broken link, or parent directory link is not disposable. If a
conflict decision is missing, show the affected relative path and ask whether to
retain it as local-only or back up that single file before replacing it. Keep
content comparisons private. A reviewed wrapper may implement `--backup`; confirm
it only moves conflicting leaf files to a unique backup directory and restores
them on failure. Never infer those guarantees from the option name.

For manual recovery, create a unique backup directory in a user-selected location
outside package sources. Check its parents are real directories. Record each
original relative path. Move only that selected leaf file, then repeat simulation
and linking; if linking fails, remove only the newly created link verified to
point at that source, and restore only if the destination is still absent. If
another process changed it, preserve both and report the backup's exact location.
For restoration, unlink the selected package first, recheck the destination and
move the chosen original file back. Never overwrite a newly appeared destination.
Moving entire application directories and unfolding parent symlinks is a separate
migration, not conflict cleanup. Preview lists moves but performs none.

## Remove selected links

Keep package sources and manifest entries until the user separately requests
source deletion. Check the current owned links; resolve unexpected or foreign
links before running the selected deletion. Preview and then remove only Stow's
owned links using the same reviewed policy:

```bash
cd "$DOTFILES_REPO"
stow --dir="$DOTFILES_REPO" --target="$DOTFILES_TARGET" --no-folding --verbose --simulate --delete "$DOTFILES_PACKAGE"
stow --dir="$DOTFILES_REPO" --target="$DOTFILES_TARGET" --no-folding --verbose --delete "$DOTFILES_PACKAGE"
node "$SKILL_DIR/scripts/dotfiles.js" inspect --repo "$DOTFILES_REPO" --target "$DOTFILES_TARGET" --package "$DOTFILES_PACKAGE"
```

Missing links are now expected. Verify package sources, unrelated files and local
overrides remain. If removing the package from version control too, unlink before
removing its manifest entry, then review/stage only the explicitly requested paths.
No commit, push or release follows merely from asking to inspect/manage dotfiles.

## Validation

Use the repository's focused tests and syntax checks (`bash -n`, `zsh -n` or a
format parser as appropriate). `git diff --check` catches whitespace issues.
The skill's own tests use temporary homes. Its local lifecycle dogfood includes
an edit, added package, simulation, repeated install, unlink and individual-file
recovery; it never changes live home files or launches terminal agent sessions.
