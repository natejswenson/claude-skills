# The CHANGELOG house style

Every entry has to satisfy two readers: a person deciding whether to upgrade, and
an awk script.

## The shape

```markdown
## [0.4.0] - 2026-08-02

### Added

- **A one-line claim in bold, then the explanation.** What changed, why it was
  wrong before, and what it costs the reader to adopt.

### Fixed

- **The bug stated as a behaviour, not a diff.** "gh inferred the wrong repo and
  a dispatch into it still exits 0" beats "add --repo to dispatchReleaseWorkflow".
```

`## [<version>] - <YYYY-MM-DD>` is what `release prepare` writes. Both that form
and `## <version> (<date>) — <title>` extract correctly; the skills in this
monorepo use the second and the splice writes the first, and both work because
the extractor keys on the version string, not the punctuation.

## The extractor you have to survive

`_release.yml` pulls the GitHub Release notes with:

```awk
/^## / && index($0, ver) {flag=1; next}
flag && /^## / {flag=0}
flag {print}
```

Everything under the first `## ` heading containing the version, up to the next
`## `. Three consequences:

- **A version string appearing in an earlier heading steals the notes.** A
  heading like `## [0.4.0] — supersedes 0.3.3` will be matched when releasing
  0.3.3. Keep other versions out of headings.
- **Sub-headings must be `###`, not `##`.** A `## Added` would terminate the
  block and ship an empty release note.
- **An empty section ships silently.** The workflow falls back to a bare
  `<name> v<version>` title, which looks deliberate and is not. `release prepare`
  refuses an empty notes file for this reason.

## Writing the entry

The draft from `changelog-draft` is commit subjects. Commit subjects say what was
typed. A release note says what changed for the reader.

- **Lead with the consequence, not the mechanism.** "A dispatch into the wrong
  repository still exits 0, so this failed silently" tells a reader whether they
  were affected. "Added a `--repo` flag" does not.
- **Say what breaks, in the first sentence of the bullet.** If a reader has to
  reach the third line to learn they need to change something, the note failed.
- **Delete the `Internal` section** unless a chore genuinely changed something a
  user can observe. Most cannot.
- **Never invent a rationale.** If the commit history does not say why a change
  was made, say what it does and stop. A plausible-sounding invented reason is
  worse than a thin note — this repo's back-catalogue was once rewritten because
  entries had fabricated code, hashes and quotes.

## The rule that costs the most when broken

**The version bump and its CHANGELOG entry land in the same change.** `_release.yml`
reads the notes off whatever is on `main` at the moment the release is dispatched,
and skips a tag that already exists. So a CHANGELOG entry that arrives in a later
promotion than its version bump is notes the release will never carry, and no
retry fixes it — the tag is already there, so the workflow no-ops. Repairing it
afterwards means `gh release edit <tag> --notes-file`, because re-cutting means
deleting a published tag, which is worse.

This used to be far sharper: until 2026-08-02 the release jobs also ran on
`push`, so a `dev → main` merge tagged and npm-published within seconds and the
window between bump and notes was measured in seconds too. Releases are now
`workflow_dispatch`-only, so there is time between landing the bump and cutting
the tag. Do not treat that as licence to split them — the dispatch usually
follows the merge immediately, because `release cut` does both.
