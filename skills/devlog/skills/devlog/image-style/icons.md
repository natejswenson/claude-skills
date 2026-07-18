# Cover icon catalog

Twenty small, secondary/accent icons — **never the hero illustration itself**. Each is a
real inline SVG, 24×24 viewBox, stroke-only (`stroke="currentColor" fill="none"`), so it
recolors for free via CSS `color: #ededed` or `color: #fff503` (the accent yellow) —
never `fill`. Wrap every usage in a container carrying `data-catalog-icon="<name>"`
(the exact `<name>` from the table below) — `render-cover`'s geometry guard reads this
attribute to confirm no catalog icon has drifted into the hero zone.

**These are for the kicker-area accent glyph only** (see `style-guide.md`'s hero-zone
grid contract) — never for the hero illustration's own mechanism/nodes, which are always
freehand SVG the agent draws itself. Look up a concept below instead of re-deriving an
icon from scratch; if a post's concept doesn't map cleanly to any of these 20, that's a
signal the post doesn't need an accent icon at all (a terminal-glyph accent or no accent
is always a valid choice — see `style-guide.md`).

## Topic → icon cheat sheet

| Topic / keywords in title or summary | Icon |
|---|---|
| agent, LLM, Claude, subagent, prompt | `agents` |
| test, testing, assert, spec, coverage | `testing` |
| CI, CD, pipeline, workflow, build | `ci-cd` |
| git, commit, branch, merge, tag | `git` |
| a11y, accessibility, aria, screen reader | `accessibility` |
| debug, bug, fix, root cause, trace | `debugging` |
| CLI, command, terminal, flag, argv | `cli` |
| config, settings, options, flags | `config` |
| deploy, release, ship, publish, rollout | `deploy` |
| database, manifest, schema, storage | `database` |
| API, endpoint, request, response | `api` |
| search, filter, query, lookup | `search` |
| auth, login, token, credential, permission | `auth` |
| monitor, metric, telemetry, dashboard | `monitoring` |
| cover, image, render, screenshot, thumbnail | `cover-image` |
| performance, speed, latency, throughput | `performance` |
| parse, parser, tokenize, frontmatter | `parsing` |
| cache, staging, memoize, invalidate | `caching` |
| UI, layout, component, page, nav | `ui` |
| network, remote, fetch, clone, push/pull | `networking` |

## Icons

### `agents`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="8" width="14" height="11" rx="2"/>
  <line x1="12" y1="8" x2="12" y2="4"/>
  <circle cx="12" cy="3" r="1"/>
  <circle cx="9" cy="13" r="1.2"/>
  <circle cx="15" cy="13" r="1.2"/>
  <line x1="9" y1="17" x2="15" y2="17"/>
</svg>
```

### `testing`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="2"/>
  <polyline points="8,12.5 11,15.5 16,9"/>
</svg>
```

### `ci-cd`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="4.5" cy="12" r="2"/>
  <circle cx="12" cy="12" r="2"/>
  <circle cx="19.5" cy="12" r="2"/>
  <line x1="6.5" y1="12" x2="10" y2="12"/>
  <line x1="14" y1="12" x2="17.5" y2="12"/>
  <polyline points="15.5,10 17.5,12 15.5,14"/>
</svg>
```

### `git`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="2"/>
  <circle cx="6" cy="18" r="2"/>
  <circle cx="18" cy="10" r="2"/>
  <line x1="6" y1="8" x2="6" y2="16"/>
  <path d="M6 8 C6 10, 8 10, 12 10 S18 10, 18 12"/>
</svg>
```

### `accessibility`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="7.5" r="1.4"/>
  <line x1="7" y1="11" x2="17" y2="11"/>
  <line x1="12" y1="11" x2="12" y2="15"/>
  <line x1="12" y1="15" x2="9" y2="18.5"/>
  <line x1="12" y1="15" x2="15" y2="18.5"/>
</svg>
```

### `debugging`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="8" y="8" width="8" height="10" rx="4"/>
  <line x1="12" y1="4" x2="12" y2="8"/>
  <line x1="6" y1="10" x2="8" y2="11"/>
  <line x1="6" y1="14" x2="8" y2="14"/>
  <line x1="6" y1="18" x2="8" y2="17"/>
  <line x1="18" y1="10" x2="16" y2="11"/>
  <line x1="18" y1="14" x2="16" y2="14"/>
  <line x1="18" y1="18" x2="16" y2="17"/>
</svg>
```

### `cli`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2"/>
  <polyline points="7,10 10,12.5 7,15"/>
  <line x1="12" y1="15" x2="16" y2="15"/>
</svg>
```

### `config`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"/>
</svg>
```

### `deploy`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="19" x2="12" y2="6"/>
  <polyline points="6,12 12,6 18,12"/>
  <line x1="5" y1="20" x2="19" y2="20"/>
</svg>
```

### `database`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="6" rx="7" ry="2.5"/>
  <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>
  <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>
</svg>
```

### `api`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="9,5 3,12 9,19"/>
  <polyline points="15,5 21,12 15,19"/>
</svg>
```

### `search`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="10.5" cy="10.5" r="6"/>
  <line x1="15" y1="15" x2="20" y2="20"/>
</svg>
```

### `auth`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="11" width="14" height="9" rx="2"/>
  <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  <circle cx="12" cy="15" r="1.3"/>
</svg>
```

### `monitoring`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="3,14 8,14 10,8 14,18 16,14 21,14"/>
</svg>
```

### `cover-image`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="18" height="14" rx="2"/>
  <circle cx="8.5" cy="10" r="1.5"/>
  <polyline points="4,17 9,12 13,16 16,13 20,17"/>
</svg>
```

### `performance`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 16a8 8 0 0 1 16 0"/>
  <line x1="12" y1="16" x2="16" y2="10.5"/>
  <circle cx="12" cy="16" r="1"/>
</svg>
```

### `parsing`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 4c-2 0-3 1-3 3v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3"/>
  <path d="M15 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3"/>
</svg>
```

### `caching`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="4" width="14" height="4.5" rx="1"/>
  <rect x="5" y="9.75" width="14" height="4.5" rx="1"/>
  <rect x="5" y="15.5" width="14" height="4.5" rx="1"/>
</svg>
```

### `ui`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2"/>
  <line x1="3" y1="8.5" x2="21" y2="8.5"/>
  <line x1="8" y1="4" x2="8" y2="8.5"/>
</svg>
```

### `networking`
```svg
<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="5" r="2"/>
  <circle cx="5" cy="18" r="2"/>
  <circle cx="19" cy="18" r="2"/>
  <line x1="12" y1="7" x2="5" y2="16"/>
  <line x1="12" y1="7" x2="19" y2="16"/>
  <line x1="7" y1="18" x2="17" y2="18"/>
</svg>
```
