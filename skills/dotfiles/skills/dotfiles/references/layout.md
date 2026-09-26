# Expected layout

The default checkout is `~/localrepo/dotfiles`. Both the checkout and target home
are configurable. A checkout below home is normal; the target cannot be the
checkout or inside it, and a managed destination cannot overlap the checkout.
A legacy `~/.dotfiles` symlink can be resolved without creating or changing it.

```text
dotfiles/
  packages.json
  bootstrap.sh                  # optional, inspect before using
  scripts/                      # tooling, never an inferred package
  tests/
  specs/
  zsh/.zshrc
  git/.config/git/ignore
  editor/.config/editor/settings.json
```

For this example, `packages.json` is `["zsh", "git", "editor"]`. Only listed
packages count. Package names are single safe directory names; packages must be
real directories with at least one eligible regular file. Source symlinks and
special files require a separate migration. No exact or ancestor destination may
be owned by two packages, even if only one is currently selected. Packages may
share real directory parents such as `.config`.

Each source path maps to the same path below the target home. Link individual
files using GNU Stow's `--no-folding`, explicit `--dir` and explicit `--target`.
Otherwise Stow's parent default would target `~/localrepo`, not home. Keep parent
application directories real so newly created credentials/runtime data do not
land in a repository through a directory symlink. Existing parent links are
blockers, even if they currently point into this checkout.

The helper reports eligible files independently of Stow's ignore expressions.
`.stow-local-ignore` is metadata, not a managed file. Existing `.stowrc` and ignore
files are flagged for review. Inspect the actual invoking user's `$HOME/.stowrc`
and `$HOME/.stow-global-ignore` too if using a different target. A clean result
always carries `linkPolicy: review-required`; it is not an installer dry run.

Keep secrets, `*.local` overrides, `.env*`, auth files, private keys and known
agent/runtime stores outside packages. The helper excludes common names, whole
`.ssh`, `.aws`, `.gnupg` and `.local/share` trees, Claude global instructions and
runtime directories, and Codex's main config/instructions/auth/runtime paths.
This bounded list is intentionally conservative and cannot detect secrets under
arbitrary names or embedded in a shared settings file. Review content privately
before adding any configuration. Use environment references or external local
includes for machine-specific values; do not generate credentials as examples.

A shared named Codex profile and native skills can coexist with Claude settings
and commands. Do not replace global host instructions or MCP connections. This
skill does not require either host's personal directory to be renamed or copied.
macOS paths with spaces (for example editor settings under `Library/Application
Support`) are supported. The checker also works on Unix/Linux layouts; Homebrew
and macOS-specific bootstrap behavior are not portable requirements.
