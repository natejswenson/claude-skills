# Card icon catalog

Paste-ready inline SVG line icons for the light card family. They match the
reference aesthetic: single-color strokes, 24×24 viewBox, rounded caps. Every
icon-chip class (`.glyph svg`, `.ig svg`, `.ic svg`, plus the how-to family's
`.sic svg` / `.gic svg`) already sets `fill:none; stroke-width:2` and rounded
joins, so you only choose the icon and the stroke color.

## How to use

1. Drop the `<svg>…</svg>` into the icon chip **that the card's template uses** —
   follow each template's `ICONS:` comment for the right wrapper class. The chip
   class varies by card (`.ig` / `.glyph` / `.ic`, and `.gic` for howto-grid,
   `.sic` for the howto spine); the `tint-*`/`s-*` pair is the same everywhere:
   ```html
   <div class="ig tint-blue"><svg class="s-blue" viewBox="0 0 24 24">…</svg></div>
   ```
2. Pair a tint with its stroke: `tint-blue`/`s-blue` (blue), `tint-green`/`s-green`
   (green), `tint-teal`/`s-teal` (teal), `tint-gold`/`s-gold` (gold).

## The rule: meaningful and few

**Match every glyph to the idea.** A people icon for a team, a git-branch for a
pipeline, a lock for security. For the hero teaching moment, draw the actual
concept (a T, two ladders, a flow) rather than reaching for a generic shape.
Generic circles/squares are a *last resort*, not a default — and keep the count
low (2–4 meaningful icons beat eight; more than that reads as clip-art).

## Topic → icon cheat-sheet (start here)

Don't scan the whole catalog — look up the idea, grab the named glyph, copy its `<svg>`
paths from the catalog below. Pair a `.tint-*` fill with the matching `.s-*` stroke.

| The step / idea is about… | Use | Suggested tint |
|---|---|---|
| A pipeline / CI / branching / mapping jobs | `git-branch` or `workflow` | blue |
| A model / compute / a token or key swap | `cpu` | teal |
| Security / auth / a trust policy / secrets | `lock` (or `shield`) | gold |
| Verifying / a passing check / "it worked" | `check-circle` | green |
| Data / a store / caching | `database` | teal |
| Infra / a server / a deployment | `server` or `cloud` | blue |
| Running a command / the CLI | `terminal` | blue |
| A team / people / an audience | `users` (one person: `user`) | blue |
| Speed / leverage / a big win | `zap` | gold |
| Growth / cost or metric moving up | `trending-up` | green |
| Time / a deadline / a TTL / latency | `clock` | gold |
| Scope / a goal / what to target | `target` | green |
| An idea / the insight / the "aha" | `lightbulb` | gold |
| Learning / docs / STEM | `book-open` | teal |
| Discussion / comments / a question | `message-square` | blue |
| Craft / tooling / configuring | `wrench` | gold |
| A milestone / setting the bar | `flag` | green |
| Launch / ship it | `rocket` | blue |

For a **specific tool** (Claude, Python, AWS, GitHub, …), fetch its monochrome brand SVG
from Simple Icons instead of a generic glyph (see the catalog note).

## Catalog

> All paths assume `viewBox="0 0 24 24"`. Brand/tech logos (Claude, Python, AWS,
> GitHub) come from Simple Icons — fetch as monochrome SVG when a post is about a
> specific tool.

### People & teams
- **users** (team / management) — `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`
- **user** (a person / IC) — `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`

### Systems & engineering
- **git-branch** (systems / pipeline) — `<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>`
- **cpu** (compute / model) — `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>`
- **server** (infra) — `<rect x="2" y="3" width="20" height="6" rx="2"/><rect x="2" y="15" width="20" height="6" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>`
- **database** (data) — `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>`
- **cloud** (cloud) — `<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7-1.5A4 4 0 0 0 6 18.5"/>`
- **terminal** (CLI / code) — `<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>`
- **code** (snippet) — `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`
- **workflow** (agents / steps) — `<rect x="3" y="3" width="8" height="8" rx="1"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="8" height="8" rx="1"/>`

### Security & quality
- **lock** (security) — `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`
- **shield** (defense) — `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`
- **check-circle** (verified / pass) — `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`
- **flag** (set the bar / milestone) — `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>`
- **target** (scope / goal) — `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`
- **wrench** (craft / tooling) — `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`

### Growth & outcomes
- **trending-up** (growth / comp) — `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`
- **zap** (speed / leverage) — `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`
- **rocket** (launch / ship) — `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>`
- **gauge** (performance) — `<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`
- **clock** (time / deadline) — `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`

### Knowledge & communication
- **lightbulb** (idea) — `<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>`
- **book-open** (learning / STEM) — `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`
- **message-square** (discussion) — `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`
