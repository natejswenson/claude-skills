---
name: release
description: Cut a release for one named skill, package or service and prove the tag exists. Use when the user says "release devlog", "release ghostwriter", "cut a release for press", "ship a new version of X", "what is unreleased", "tag the current main", or asks whether something has a release pending. Reads the commits on main since the last tag, proposes a semver bump and a CHANGELOG entry, waits for approval, then lands the bump and reports the tag URL — never claiming a release happened until the tag is read back from the remote.
user_invocable: true
version: 0.1.0
---

# /release — one named thing, one tag, proven

You are running the **release** skill. It turns "release devlog" into a tag that
exists, having agreed the version and the notes with the user on the way.

**Announce at start:** "I'm using the release skill to cut this one end to end."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against a repo other than the
> current one.

## The one rule

**A release is done only when the tag is read back from the remote — a dispatched
workflow, a merged PR and a green check are all still not done, and none of them
may be reported as a release.**

Every intermediate signal in this path can succeed while no tag is ever cut. A
workflow dispatch exits 0 for a run that later fails. A promotion can merge while
the release job errors. `_release.yml` deliberately no-ops when a tag already
exists, so a "successful" re-run can correct nothing. The tag, fetched from
origin, is the only evidence — which is why `cut` polls for it, and why you must
not report success from anything else.

## What is code and what is judgment

| Deterministic — the machine decides | Command |
|---|---|
| read every component's release state, blockers and collateral | `node scripts/release.js preflight` |
| group the commits since the last tag into changelog sections | `node scripts/release.js changelog-draft` |
| write the version into every version file and splice the CHANGELOG | `node scripts/release.js prepare` |
| drive the branch to a tag and read the tag back from the remote | `node scripts/release.js cut` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| which bump this release actually is | commit types are a suggestion, not a decision — only a person knows whether a refactor broke someone, and whether an 0.x component is ready to claim 1.0.0 |
| what the CHANGELOG entry says | grouped commit subjects are raw material; a release note explains why a change was made and what breaks, which no commit message reliably records |
| whether the collateral releases are acceptable | a promotion is atomic, so releasing one component releases every other bumped one — only the user can say whether shipping those today is fine |

Every mutating step is `shipflow`'s, not this skill's. `scripts/release.js`
resolves the shipflow CLI, enforces its minimum version, and reshapes its JSON
into the tables below — it never reimplements a single thing shipflow does. Two
tools answering "how do I release this?" differently is worse than either answer.

## The flow

### 1. Preflight — never ask what you can read

```bash
node scripts/release.js preflight --repo <path> [--component <name>]
```

With no `--component`, every declared component is listed — that alone answers
"what's unreleased?". With one, you get its full picture. **Never ask about
anything in that table.** The version on main, the last tag, the unreleased
commit count and the blockers are all facts.

`state` decides the whole run:

| `state` | Means | Path |
|---|---|---|
| `clean` | the released version is what's on main | needs a bump — step 2 |
| `untagged-bump-on-main` | the bump is on main but was never tagged | **no PR needed** — skip to step 4 |
| `bump-on-dev-unpromoted` | the bump is on dev, waiting to be promoted | skip to step 4 |
| `version-behind-tag` | main carries a *lower* version than an existing tag | **stop and ask** |

`version-behind-tag` means a tag was cut from something other than main. Do not
guess your way out of it; guessing is how it gets worse.

If `blockers` is non-empty, report them and stop. They are not warnings.

### 2. Agree the version — the suggestion is not the decision

`suggestedBump` comes from conventional-commit types: a `feat` makes it minor,
anything else patch, a breaking change major. Show it with its reason and the
unreleased commits, and let the user decide.

**`suggestedBumpCapped: true` must be said out loud.** It means a breaking change
was held at minor because the component is still 0.x. Declaring 1.0.0 is an
API-stability promise, and no commit message is entitled to make it on the
maintainer's behalf — offer it, never take it.

### 3. Draft the notes, then write them yourself

```bash
node scripts/release.js changelog-draft --repo <path> --component <name> --version <x.y.z>
```

This returns the commits grouped into Keep-a-Changelog sections. **It is raw
material, not the entry.** A list of commit subjects tells a reader what was
typed, not what changed for them or what breaks. Rewrite it into prose in the
house style (`references/changelog.md`), show it to the user, and only then:

```bash
node scripts/release.js prepare --repo <path> --component <name> \
  --version <x.y.z> --notes-file <path>
```

Local only, no network. It works in a throwaway git worktree, so unrelated
uncommitted work in the user's tree is untouched. The version bump and the
CHANGELOG entry land in **one commit** — the notes are read off `main` when the
release is dispatched, so a CHANGELOG arriving in a later promotion than its
version is notes the release will never carry.

### 4. Name the collateral, then cut

**Before the irreversible step, say out loud every component in `collateral`.**
A `dev → main` promotion is atomic and carries all of dev, so those components'
bumps land on `main` with the one you named.

They are **not released** by that. Every caller's release job is
`workflow_dispatch`-only, and `cut` dispatches exactly one component — so merging
tags nothing, and each collateral component simply becomes
`untagged-bump-on-main`, releasable later on purpose. Say the list anyway: the
user should know what their promotion moves, and which components are now one
dispatch away from a release nobody asked for.

```bash
node scripts/release.js cut --repo <path> --component <name> \
  --expect-status-hash <hash-from-preflight>
```

`--expect-status-hash` is mandatory. If it is rejected as stale, the repo moved
since the table the user approved — re-run preflight, re-confirm, and pass the
new hash. Never reach for `--skip-hash-check` to make the error go away.

**`cut` will usually return `done: false`, and that is not an error.** The full
path — feature PR, checks, merge, promotion, auto-merge, dispatch, release run,
tag — takes longer than one call should block for. Each call advances as far as
it can and reports the `stage` it is parked at. **Call it again, unchanged, until
`done: true`.** Say one short line between calls (`waiting on the promotion to
auto-merge…`) so the user sees progress rather than dead air.

**The merge cuts nothing — this skill does.** Every release job in this repo is
`workflow_dispatch`-only, and `cut` dispatches one named component after its
promotion lands. That dispatch is the only way a tag is ever created here, which
is precisely why a merge can no longer surprise anyone with a release.

### 5. Report the tag, and only the tag

`done: true` carries `tag` and `releaseUrl`, both read back from origin. Report
those. If you stopped before that — because checks failed, because the user
declined, because the wait ran out — **say which stage you reached and that the
release did not happen.** Do not round it up.

## Requirements

- **`shipflow` ≥ 0.4.0.** Every mutating step is one of its `release-*` commands,
  which did not exist before then. `release.js` checks this at startup and stops
  with a plain message rather than failing obscurely three steps later.
- **`gh`, authenticated** with repo write access. Every check is a `gh` API call.
- **A repo with `.github/shipflow.json`.** A repo with no `release.components`
  block gets one component inferred from its root, so a single-project repo needs
  no extra config.

## Rules that are not negotiable

- **A release is done only when the tag is read back from the remote — a
  dispatched workflow, a merged PR and a green check are all still not done, and
  none of them may be reported as a release.**
- **Never run `cut` without naming the `collateral` list to the user first.**
- **Never claim a result you did not observe.** Say what you verified and what you
  did not.

## Error handling

- **`shipflow-too-old`** — the installed shipflow predates the `release-*`
  commands. Say the version found and the version needed. Do not attempt the
  steps by hand with `gh`; the guards are what make this safe.
- **`component-files-dirty`** — this component's own version files or CHANGELOG
  have uncommitted edits. Unrelated dirt elsewhere is reported as a note and is
  deliberately not a blocker.
- **`version-unreadable-on-main`** — the version files disagree with each other.
  A disagreement is a hard refusal, never a "pick the highest": releasing from a
  disagreeing set tags one version and ships another.
- **Checks failed on the release PR** — `cut` stops and names them. Fix them and
  call `cut` again; it resumes from live state, so nothing needs undoing.

## What's here

| Path | Is |
|---|---|
| `scripts/release.js` | the CLI: `preflight`, `changelog-draft`, `prepare`, `cut` |
| `references/anatomy.md` | the four stages of a run, what each proves, and what may never be reported as a release |
| `references/changelog.md` | the Keep-a-Changelog house style, and the extractor in `_release.yml` an entry has to survive |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.9.0 sha256:ce9c1c6b30d6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Never print file contents into the conversation.** Not a fetched page, not a
  source file, not a script's own source. Scripts hand each other *paths*; when
  you need a file's text in context, use the `Read` tool rather than `cat`,
  `sed`, `head`, or a `--show` flag. Anything the user already has open
  somewhere is a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, `Read` the
  rendered image so the user sees it, instead of writing a paragraph about it.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->
