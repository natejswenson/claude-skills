# linkedin-ghostwriter

A Claude skill that writes engaging LinkedIn posts **in your own voice**, on topics you
care about, and publishes them to your profile after you approve — no copy-paste.

It works in three moves: **learn your voice** from your past posts → **draft** a new post
(from trending news, your interests, or a topic you name) → **you approve** → it **publishes**
via LinkedIn's official API.

> Design choice: posts are **never** published without your review. LinkedIn's algorithm
> suppresses low-effort AI text, and this is your professional identity. You stay in the loop.

## How it works

```
Shares.csv (your export) ──> extract_posts.py ──> data/my_posts.md
                                                        │
                                                        ▼
                                          Claude builds voice/voice-profile.md
                                                        │
   topic (news / interests / ad-hoc) ───────────────────┤
                                                        ▼
                                          Claude drafts ──> drafts/*.md
                                                        │  (you read & approve)
                                                        ▼
                                          linkedin_post.py ──> your LinkedIn feed
```

## One-time setup

You only do this once. Just tell Claude **"set up linkedin-ghostwriter"** and it will walk
you through each step. The pieces:

1. **Create a LinkedIn developer app** at <https://www.linkedin.com/developers/apps>.
   - Add the **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** products.
   - Under **Auth**, add redirect URL `http://localhost:8765/callback`.
   - Copy the **Client ID** and **Client Secret**.
2. `cp .env.example .env` and paste in your Client ID / Secret.
3. **Authorize:** `python3 scripts/linkedin_auth.py` — opens your browser, you click Allow,
   and it writes your access token + person URN back into `.env`.
4. **Export your posts:** LinkedIn → Settings → *Data privacy* → *Get a copy of your data* →
   select **Posts/Shares**. The email arrives in ~10 min. Unzip and drop `Shares.csv` into `data/`.
5. **Build your voice profile:** `python3 scripts/extract_posts.py`, then ask Claude to
   *"build my voice profile"* — it reads your posts and writes `voice/voice-profile.md`.
6. **Set your interests & voice notes:** copy the templates and fill them in —
   `cp voice/interests.example.md voice/interests.md` (the themes you post about) and
   `cp voice/voice-notes.example.md voice/voice-notes.md` (direct feedback that overrides
   the generated profile). Both files are gitignored — they're your personal data.

## Everyday use

Just ask Claude things like:

- *"Write me a LinkedIn post about something trending in my field."*
- *"Draft a post on <your topic>."*
- *"Give me a post from my interests."*

Claude drafts it in your voice, shows it to you, and on your OK runs the publish step.

## Optional: the release radar

If you post about a fast-moving field, the **release radar** keeps a running list of recent
developments to react to. `scripts/release_radar.sh` runs a headless Claude session that
web-searches the sources defined in `scripts/release_radar_prompt.md` and writes a dated
digest to `research/` — each item paired with a suggested, voice-aware angle. Then you just say:

- *"Draft a post from item 2 in the radar."*

Run it by hand (`bash scripts/release_radar.sh`) or schedule it with the included macOS
launchd template (`scripts/release_radar.plist.example` — see its header for setup).

> **Prerequisites:** the radar shells out to the [`claude` CLI](https://docs.claude.com), so it
> must be installed and on your `PATH`. The desktop notification and the launchd schedule are
> **macOS-only**; on other systems you can still run the script by hand — it writes the digest,
> it just won't pop a notification.

> **The radar only researches. It never posts.** That's deliberate: LinkedIn's API Terms
> (§3.1) prohibit *automated posting*, not automated research. A human still picks an item,
> reviews the draft, and approves it before anything publishes. See [`COMPLIANCE.md`](COMPLIANCE.md).
>
> Edit `scripts/release_radar_prompt.md` to point the radar at *your* field's sources — the
> default is tuned for Claude/Anthropic releases.

## Optional: diagrams & cards

You can attach a **visual** to any post — entirely optional, off by default. Two kinds:

- **Technical diagrams** — Mermaid flows / architecture / sequence (Claude writes the `.mmd`).
- **Designed cards** — a hero/stat/before-after graphic (HTML/CSS from `assets/card-template.html`).

Both render to a high-DPI PNG using **your own brand guide** — copy `assets/diagram.css.example`
to `assets/diagram.css` (gitignored, so your styling isn't shared) and set your `--byline`
(name · site, shown at the bottom of every visual) plus the palette. Just ask: *"…and make a
diagram to go with it"* or *"…with a card."* Claude drafts the source, renders it, **shows you the
PNG**, and only attaches it to the post after you approve — text-only stays the default if you
don't ask.

This feature needs a one-time setup (a headless browser):

```
python3 -m venv .venv
.venv/bin/pip install -r requirements-diagrams.txt
.venv/bin/playwright install chromium
```

Render manually if you like:
`​.venv/bin/python scripts/render_image.py --type mermaid --in images/foo.mmd --out images/foo.png`
(cards: `--type card --in images/foo.html`). Output is ~1200–2400 px, sized for the feed, and the
PNG **opens in your image viewer automatically** (pass `--no-open` to skip).

> Rendering is **fully local** — nothing is sent to a third party. Generated PNGs and their
> sources live in `images/` (gitignored). Visuals must not misrepresent facts, and always get
> alt text for accessibility.

## Files

| Path | What it is |
|------|------------|
| `.claude/skills/linkedin-ghostwriter/SKILL.md` | The skill instructions Claude follows |
| `scripts/extract_posts.py` | Turns `Shares.csv` into clean text for voice analysis |
| `scripts/linkedin_auth.py` | One-time OAuth; writes token + URN to `.env` |
| `scripts/linkedin_post.py` | Publishes a post (`--dry-run` to preview the API payload) |
| `scripts/release_radar.sh` | Optional research run that builds a digest of recent developments |
| `scripts/release_radar_prompt.md` | What the radar searches for — edit for your field |
| `scripts/release_radar.plist.example` | macOS launchd template to schedule the radar |
| `scripts/render_image.py` | Optional: renders a Mermaid diagram or HTML card to a PNG |
| `assets/diagram.css.example` | Brand-guide template — copy to `assets/diagram.css` (gitignored) and set your byline/palette |
| `assets/` | Diagram templates + vendored `mermaid.min.js` |
| `voice/*.example.md` | Templates — copy to `voice/interests.md` / `voice/voice-notes.md` |
| `voice/voice-profile.md` | Your generated style guide (gitignored; the heart of "sounds like me") |
| `drafts/`, `research/`, `images/` | Generated drafts, radar digests & visuals, kept local (gitignored) |

## Security

- All secrets live in `.env`, which is gitignored. `.env.example` ships placeholders only.
- Your post export (`data/`), drafts (`drafts/`), radar digests (`research/`), filled-in voice
  files (`voice/interests.md`, `voice/voice-notes.md`, `voice/voice-profile.md`), and local
  Claude settings (`.claude/settings.local.json`) are all gitignored — personal data stays local.
- The **core** (drafting + publishing) uses only the Python 3 standard library — no third-party
  packages. The **optional** diagram feature is the one exception: it needs Playwright + Chromium
  (installed into a local `.venv`), and only if you choose to use it.

## Notes & limits

- Access tokens expire after ~60 days. When publishing fails with an auth error, just rerun
  `python3 scripts/linkedin_auth.py` to refresh (takes 30 seconds).
- Review-then-publish is **permanent, not a v1 limitation**. LinkedIn's API Terms (§3.1)
  prohibit automated posting; keeping a human approving each post is what keeps this compliant.
  See [`COMPLIANCE.md`](COMPLIANCE.md). Do not add unattended/scheduled posting.
- **"Single-user" is about the LinkedIn app, not the code.** Sharing/forking this repo is fine —
  each person runs their *own* instance with their *own* LinkedIn developer app and only posts to
  their *own* profile. What you must not do is let multiple people post through one app, which
  triggers privacy-policy and security obligations under §5/§7.
