---
name: pluginsync
description: Refresh the locally-installed Claude Code plugin marketplaces so newly released skill versions are actually on disk. Use when the user says "update my marketplace", "refresh my skills", "update the claude-skills plugins", "am I on the latest skills", "install the new skill", or "why is /skillfactory still the old version". Reports installed vs available version per plugin, installs what is missing, updates what drifted, flags plugins shadowed by a stale personal copy in ~/.claude/skills, and always says whether a restart is still needed.
user_invocable: true
version: 0.1.0
---

## Codex runtime

When running in Codex, invoke this skill as `$pluginsync`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

## Codex plugin updates

In Codex, use this route instead of the Claude CLI workflow below. The bundled
`scripts/pluginsync.js` manages Claude installations only.

1. Run `codex plugin marketplace list --json` and
   `codex plugin list --available --json --marketplace claude-skills`.
   Inspect the returned schema and report available and installed versions
   separately. Do not infer installation from marketplace membership.
2. For a Git marketplace, run `codex plugin marketplace upgrade claude-skills`
   when refreshing is requested. For this local checkout, run
   `python3 tools/sync_codex.py` from the repository root after source changes.
3. Install or refresh requested plugins with
   `codex plugin add <name>@claude-skills --json`, then re-read the list and
   installed manifest. If the version/content did not move, report it as stalled.
   Consult `codex plugin --help` if the installed CLI differs. Never fall back to
   `claude plugin` or edit Codex's internal cache/registry by hand.
4. Report what is on disk and ask the user to start a new Codex session to verify
   loading. A successful install does not prove the current session reloaded.

A refresh removes no plugins or personal skills. Inspect duplicate skill
entrypoints in `~/.agents/skills` and `~/.codex/skills` without deleting user data.

# /pluginsync — the marketplace on disk, not the one you assume

You are running the **pluginsync** skill. It reconciles the plugins installed on
this machine with what the marketplace actually offers.

**Announce at start:** "I'm using the pluginsync skill to reconcile your installed plugins with the marketplace."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once.

## The one rule

**A plugin is not refreshed until the new version is read back off disk, and it
is not live until Claude Code restarts — report those as three different states
and never collapse them into one.**

Every command in this flow exits 0 whether or not anything moved. `claude plugin
update` prints no version and returns success when it no-ops. So "✓ updated
skillfactory" followed by a `/skillfactory` that still runs the old version is not a rare edge
case — it is the default failure, and it is indistinguishable from success
unless the report keeps the three states apart:

| State | Means | How it is known |
|---|---|---|
| **available** | the marketplace offers this version | `plugin.json` at the marketplace source |
| **on disk** | this version is installed here | `claude plugin list --json`, re-read after every write |
| **live** | this version is loaded in the running session | only true after a restart — never assert it |

**Never say a plugin is updated because a command succeeded.** Say it because
the version on disk changed. If it did not change, the row is `stalled`, and
`stalled` is reported as loudly as a failure.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| resolve every marketplace's install location and each plugin's available version from plugin.json on disk | `node scripts/pluginsync.js check --no-fetch` |
| diff installed against available and classify each row | `node scripts/pluginsync.js check` |
| install/update each drifted plugin and read the resulting version back off disk | `node scripts/pluginsync.js apply` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide whether an orphan or disabled plugin is deliberate or rot | nothing on disk records intent — a disabled project-scoped plugin is normal, a disabled user-scoped one is usually a forgotten experiment |
| decide what to do about a plugin shadowed by a personal copy in ~/.claude/skills | the shadowing directory sometimes holds user data alongside the stale SKILL.md, so deleting the directory and deleting the shadow are different actions with different consequences |
| explain a stalled row | the CLI exits 0 either way, so why a version did not move is a diagnosis, not a field |

## The flow

### 1. Check — never ask what you can read

```bash
node scripts/pluginsync.js check
```

One row per plugin, and it answers everything a question would. **Never ask
about anything in it** — which plugins exist, what is installed, what drifted
and what is shadowed are all facts. A confirmation is not a question.

`--no-fetch` skips the marketplace refresh and reads disk only.
`--marketplace <name>` targets a marketplace other than `claude-skills`.

Show the table as the script printed it. Do not re-summarise it in prose, and do
not omit the `ok` rows — "these eleven are already current" is the answer to
half the reasons someone runs this.

### 2. Ask once, only if there is something to decide

If every row is `ok`, say so and stop; there is nothing to ask. Otherwise ask
one question — whether to apply — and only that. Three row types need a
judgment call and none of them are the script's to make:

| Row | What it means | What to say |
|---|---|---|
| `orphan` | installed, no longer offered by the marketplace | Ask before removing. **Never uninstall an orphan on your own** — it is more likely a plugin the user still wants than a mistake. |
| `disabled` | installed and current, but switched off | Usually deliberate for project-scoped plugins. Mention it once; do not re-enable it unprompted. |
| `shadowed` | `~/.claude/skills/<name>/SKILL.md` wins over the plugin | Deleting the *directory* and deleting the *shadow* differ — that directory sometimes holds user data. Offer to remove only the `SKILL.md`. |

### 3. Apply

```bash
node scripts/pluginsync.js apply
```

Installs and updates every drifted row, then re-reads the installed list and
compares. Report the table it prints, including any `stalled` row, and never
soften one into a success.

### 4. Say what is live

Close with the restart, always. The user's next `/skillfactory` runs the old version
until Claude Code restarts, no matter how clean the table looked.

## Commands

| Command | Returns |
|---|---|
| `pluginsync check` | one row per plugin — Plugin, Installed, Available, Action (`ok`/`update`/`install`/`orphan`/`disabled`/`error`) — plus a warning per shadowing personal skill, and a footer counting what would change |
| `pluginsync apply` | the same rows re-read after every write — Plugin, Was, Now, Outcome (`installed`/`updated`/`stalled`/`failed`) — where `stalled` means the command exited 0 and the version on disk did not move |

Both take `--json` for the structured payload, and `--home` / `--installed-json`
so the evals can run offline.

## Rules that are not negotiable

- **A plugin is not refreshed until the new version is read back off disk, and it is not live until Claude Code restarts — report those as three different states and never collapse them into one.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never report a stalled row as updated.** The command exiting 0 is not
  evidence; the version on disk is the only evidence.
- **Never uninstall an orphan without being asked.** A refresh removes nothing.
- **An unreadable source is an error row, never a dropped one.** A plugin the
  tool could not read must never be summarised inside "everything matches".

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/pluginsync.js` | the CLI: `check`, `apply` |
| `scripts/lib/state.mjs` | the four readers — and nothing that decides |
| `scripts/lib/report.mjs` | classification and rendering; the report shape is frozen |
| `references/anatomy.md` | the fixed shape of the report — the column set, the six actions, and the footer contract |
| `references/sources.md` | where every fact comes from: known_marketplaces.json, each marketplace.json, each plugin.json, and claude plugin list --json |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.10.0 sha256:924e08b174a6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Keep file reads focused.** Scripts hand each other *paths*; when you need
  a file's text in context, use the host's available file-reading capability.
  In Claude Code, prefer `Read`; in Codex, use focused file or shell reads.
  Read only the relevant range and keep raw file contents out of user-facing
  updates. A fetched page or a script's source is usually a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, inspect the
  rendered image with the host's available image-inspection capability.
  In Claude Code, prefer `Read`; in Codex, use `view_image` when available.
  Show the rendered artifact to the user using the host's display or attachment
  capability. If inspection is unavailable, say so; do not claim visual verification.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

## The run envelope

Every interactive run uses the same semantic order. The host may render a
native question dialog or a chat question, but the content and decision shape
stay the same:

1. **Announce** — one sentence naming the skill and the work.
2. **Progress** — one short, lowercase status line for each slow operation.
3. **Decision** — ask only for a choice that is genuinely missing.
4. **Result** — lead with the outcome, then the smallest useful table or draft.
5. **Next action** — end with one clear action, or say that the run is complete.

Do not expose tool calls, shell commands, API payloads, retries, internal
reasoning, or implementation details in the user-facing result. Mention a
command, path, source, or limitation only when the user can act on it or when
omitting it would make the result unverifiable.

## Selection controls

Use the host's native selectable list whenever the user must choose from known
options. A selection is a decision surface, not a prose questionnaire:

- Use **single-select** for mutually exclusive choices, including which item,
  mode, destination, or draft the user wants.
- Use **multi-select** only when the choices are independent and the user may
  choose more than one. Say that multiple choices are allowed.
- Put the recommended or most useful option first. Give every option a concise
  label and a short consequence or description; never make the user infer what
  a choice does from a file name or number.
- Show no more than four primary options at once. Add `Show more` only when a
  longer list is useful, and make it the final option.
- Skip the selector when the user already made the choice in their request.
  Never ask the same decision twice, and never use a selector for information
  that can be reported directly.

If the host has no native selector, reproduce the same contract as a numbered
single-choice list and wait for one answer. Do not dump a raw menu, JSON array,
or tool transcript.

## Tables and detail

Tables are the default for two or more related facts. Use a short heading that
names the question the table answers, stable named columns in the same order on
every run, and one row per meaningful item. Prefer these column roles:

| Table purpose | Columns |
|---|---|
| Plan or target | `Item` · `Action` · `Status` |
| Comparison or metrics | `Item` · `Value` · `Change` · `Meaning` |
| Files or artifacts | `Artifact` · `Status` · `Next action` |
| Mutation or operation receipt | `Item` · `Action` · `Result` |

Choose the smallest role set that answers the question; do not add empty or
decorative columns. Use `—` for unavailable values and state why an entire
table is empty. Keep identifiers short, format numbers consistently, and put
the actionable interpretation in the final column when one is needed. A single
fact can be one sentence. A long table can be summarized to the changed,
failed, or user-actionable rows, with the complete artifact available at its
path when appropriate.

## Drafts and rendered artifacts

Text drafts are shown in the medium's true text format, with the exact content
the user must approve or edit. A visual draft, report, card, résumé, or other
designed artifact is an HTML file by default: write the self-contained HTML to
the skill's documented output location, open it in the user's browser, and
report the artifact path plus the one decision the user must make. Do not paste
the HTML source into chat. If a browser cannot be opened, provide the path and
say that the artifact is ready to open; do not claim that it was previewed.

When a draft requires approval, show the draft before asking for approval and
ask about that specific draft. An edit creates a new preview and a new approval
decision. Never publish, send, merge, delete, or otherwise commit a draft from
an implied or stale approval.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->
