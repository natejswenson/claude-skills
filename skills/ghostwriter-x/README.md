# ghostwriter-x

A Claude skill that writes sharp X (Twitter) posts and threads **in your own voice**
and publishes them for free through the [Typefully](https://typefully.com) API after
you approve — no copy-paste, no paid X API.

It works in three moves: **learn your voice** from your past tweets → **draft** a post
or thread (from trending news, your interests, or a topic you name) → **you approve** →
it **publishes** via Typefully, which posts to your connected X account.

> Design choice: nothing is **ever** published without your review. Every tweet is
> validated against X's real weighted 280-character rules before you even see it.

> Why Typefully? X removed its API free tier in February 2026 (new developer accounts
> pay per post). Typefully's free plan covers 1 connected X account and ~15 posts a
> month, with a clean public API — the right price for a personal posting cadence.

## How it works

```
tweets.js (your X archive) ──> extract_tweets.py ──> data/my_posts.md
                                                          │
                                                          ▼
                                          Claude builds voice/voice-profile.md
                                                          │
   topic (news / interests / ad-hoc) ─────────────────────┤
                                                          ▼
                                          Claude drafts ──> drafts/*.md
                                                          │  (numbered tweets, live char counts,
                                                          ▼   you read & approve)
                                          typefully_post.py ──> Typefully ──> your X timeline
```

## One-time setup

You only do this once. Just tell Claude **"set up ghostwriter-x"** and it walks you
through each step. The pieces:

1. **Typefully account.** Sign up at <https://typefully.com> and **connect your X
   account** in their UI (Typefully handles the X authorization).
2. **API key.** Typefully → **Settings → API** → create a key.
3. `cp .env.example .env` (into `~/.claude/ghostwriter-x/`) and paste the key in as
   `TYPEFULLY_API_KEY`.
4. **Connect:** `python3 scripts/typefully_post.py --connect` — stores your social
   set id in `.env`. No OAuth dance, no token expiry.
5. **Export your tweets:** X → Settings → *Your account* → *Download an archive of
   your data*. When it arrives, drop the archive's `data/tweets.js` into `data/`, then
   `python3 scripts/extract_tweets.py` and ask Claude to *"build my voice profile"*.
   Already using the LinkedIn `ghostwriter` skill? Claude can seed the X profile from
   that voice profile instead — no archive needed to get started.
6. **Set your interests & voice notes:** `cp voice/interests.example.md voice/interests.md`
   and `cp voice/voice-notes.example.md voice/voice-notes.md`, then fill them in.
   Both are gitignored — they're your personal data.

## Everyday use

Just ask Claude things like:

- *"Tweet something about what's trending in my field."*
- *"Draft a thread on <your topic>."*
- *"Turn my last devlog into an X thread."*

Claude drafts in your voice, shows every tweet numbered with its live weighted
character count (`[3/7 · 262/280]`), and on your OK publishes through Typefully —
single post or thread.

## X-specific rules baked in

- **280 weighted characters per tweet, enforced before preview.** URLs always count
  23, most emoji/CJK count 2 — `scripts/x_len.py` implements the twitter-text rules
  (conservatively: if it passes here, it fits on X).
- **The first tweet is the hook.** There is no "…see more" fold on X; tweet 1 must
  stand alone and earn the tap. `voice/algorithm.md` carries the reach mechanics.
- **Links go in a reply, not tweet 1** — external links in the main post suppress reach.
- **Threads over long-form.** Threads are the native long format; the skill steers
  toward ≤7 tweets, drafted as complete-thought tweets split on `---` lines.

## Optional: cards & carousels at 16:9

Any post can carry a composed **PRESS card** — rendered locally at 1200×675 (X's
landscape crop) with your own brand guide (`assets/diagram.css`, gitignored). An X
"carousel" is a **4-image post** (cover / point / point / recap) or a
thread-with-images — never a PDF. One-time setup for rendering:

```
python3 -m venv .venv
.venv/bin/pip install -r requirements-diagrams.txt
.venv/bin/playwright install chromium
```

Rendering is fully local; PNGs live in `images/` (gitignored) and every image gets
alt text.

## Optional: the release radar

`scripts/release_radar.sh` runs a headless Claude research session and writes a dated
digest of recent developments to `research/`, each item paired with a suggested post
or thread angle. Schedule it with `bash scripts/install_radar.sh` (macOS launchd;
re-run whenever the repo moves). **The radar only researches — it never posts.**

## Files

| Path | What it is |
|------|------------|
| `SKILL.md` | The skill instructions Claude follows |
| `scripts/typefully_post.py` | Publishes a post or thread via Typefully (`--dry-run` to preview, `--connect` for setup) |
| `scripts/x_len.py` | Weighted 280-character validation (twitter-text rules) |
| `scripts/extract_tweets.py` | Turns your archive's `tweets.js` into clean text for voice analysis |
| `scripts/verify_sources.py` | Source gate: every external claim needs ≥3 live distinct hosts |
| `scripts/post_outcome.py` | Records how a published post did (self-reported) |
| `scripts/render_image.py` / `render_carousel.py` / `card_lint.py` | 16:9 card rendering + lint |
| `assets/` | Landscape card templates, card language, vendored `mermaid.min.js` |
| `voice/*.example.md` | Templates — copy to `voice/interests.md` / `voice/voice-notes.md` |
| `drafts/`, `research/`, `images/` | Generated drafts, radar digests & visuals (gitignored) |

## Security

- The only secret is your Typefully API key, in `.env` (gitignored); `.env.example`
  ships placeholders only. Revoke it any time at typefully.com → Settings → API.
- Your tweet archive (`data/`), drafts, digests, and filled-in voice files are gitignored.
- The core (publishing + validation) is Python 3 **standard library only**. The
  optional card feature is the one exception (Playwright + Chromium in a local `.venv`).

## Notes & limits

- **Free plan limits:** 1 connected X account, ~15 posts/month. The script surfaces
  Typefully's 402/429 responses plainly instead of retrying past them.
- **Review-then-publish is permanent, not a v1 limitation.** This skill never posts
  unattended — a human approves every tweet, every time. See
  [`COMPLIANCE.md`](COMPLIANCE.md).
- Outcome tracking is self-reported; the skill asks how a post did a couple of days
  later and learns from that.
- Publishing is asynchronous on Typefully's side — the script polls until the post is
  live and prints the X URL. If it ever times out, check the printed Typefully draft
  link before re-running (avoid a double post).
