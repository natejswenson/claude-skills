# The report

The report is the product. It is frozen byte-for-byte in the baseline eval, so a
changed column heading or a reworded footer is a behaviour change — treat it
like one.

## `check`

```
marketplace  <name> → <source spec> (<kind>)

| Plugin | Installed | Available | Action |
|--------|-----------|-----------|--------|

error     <plugin>: <why the source could not be read>
shadowed  <plugin>: ~/.claude/skills/<plugin>/SKILL.md wins over the plugin

<footer>
```

The source spec is printed **verbatim from the config**, never resolved to an
absolute path. An absolute install path differs on every machine, and a report
that embeds one cannot be byte-compared in CI.

Rows are sorted by plugin name so the output is stable across runs.

### Actions

Precedence, worst first. `error` is never outranked.

| Action | Means |
|---|---|
| `error` | the source or its `plugin.json` could not be read — the version is unknown, not equal |
| `install` | offered by the marketplace, not installed here |
| `update` | installed at a different version than the marketplace offers |
| `orphan` | installed from this marketplace, which no longer offers it |
| `disabled` | installed and current, but switched off |
| `ok` | installed, enabled, and equal to what is offered |

`update` deliberately outranks `disabled`: a disabled plugin that is also out of
date still needs updating, and reporting only "disabled" hides the drift until
someone re-enables it and wonders why it is old.

### Footer

Exactly one line, and it always separates *on disk* from *live*.

| Condition | Line |
|---|---|
| any `error` | `<e> unreadable · <n> to change · fix the source before trusting this table` |
| nothing to change | `nothing to change · <total> plugins match the marketplace` |
| otherwise | `<n> to change · run apply, then restart Claude Code` |

An error row must never be summarised inside "everything matches" — that row is
a question mark, not a pass.

## `apply`

Same header, then:

```
| Plugin | Was | Now | Outcome |
|--------|-----|-----|---------|
```

| Outcome | Means |
|---|---|
| `installed` | was absent, is now present at the offered version |
| `updated` | the version on disk moved to the offered version |
| `stalled` | **the command exited 0 and the version on disk did not move** |
| `failed` | the command exited non-zero |

`stalled` is the load-bearing outcome, and the reason `apply` re-reads the
installed list instead of trusting exit codes.

Footer: `<n> changed on disk · not live until Claude Code restarts`, or
`nothing changed on disk`.

When `pluginsync` updates itself, a note says so — the run used the copy loaded
before it changed.

## Exit codes

| Command | Non-zero when |
|---|---|
| `check` | any `error` row |
| `apply` | any `failed` or `stalled` row |

Drift is not a failure. It is the normal reason someone ran this.
