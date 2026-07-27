# ghostwriter-x

A Claude skill that writes sharp X (Twitter) posts and threads **in your own voice**
and publishes them via the official X API v2 after you approve — no copy-paste.

It works in three moves: **learn your voice** from your past tweets → **draft** a post
or thread (from trending news, your interests, or a topic you name) → **you approve** →
it **publishes** via `POST /2/tweets`.

> Design choice: nothing is **ever** published without your review. Every tweet is
> validated against X's real weighted 280-character rules before you even see it.

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
                                          x_post.py ──> your X timeline (single or thread)
```

## One-time setup

You only do this once. Just tell Claude **"set up ghostwriter-x"** and it walks you
through each step. The pieces:

1. **Create an X developer app** at <https://developer.x.com/en/portal/dashboard>.
   - In **User authentication settings**: enable **OAuth 2.0**, app type
     *Native App* (public client) or *Web App* (confidential client — also copy the
     **Client Secret**), and add redirect URI `http://localhost:8766/callback`.
   - Copy the **OAuth 2.0 Client ID**.
   - Note your project's tier. The legacy free tier allows roughly 500 posts/month
     (~17/day); accounts created after early 2026 are on pay-per-use pricing instead.
2. `cp .env.example .env` and paste in your Client ID (and Secret if you have one).
3. **Authorize:** `python3 scripts/x_auth.py` — opens your browser, you click Allow,
   and it writes your access + refresh tokens and user id/handle back into `.env`.
4. **Export your tweets:** X → Settings → *Your account* → *Download an archive of
   your data*. When it arrives, drop the archive's `data/tweets.js` into `data/`.
5. **Build your voice profile:** `python3 scripts/extract_tweets.py`, then ask Claude
   to *"build my voice profile"*. Already using the LinkedIn `ghostwriter` skill?
   Claude can seed the X profile from that voice profile instead (shifted to X's
   shorter, punchier register) — no archive needed to get started.
6. **Set your interests & voice notes:** `cp voice/interests.example.md voice/interests.md`
   and `cp voice/voice-notes.example.md voice/voice-notes.md`, then fill them in.
   Both are gitignored — they're your personal data.

## Everyday use

Just ask Claude things like:

- *"Tweet something about what's trending in my field."*
- *"Draft a thread on <your topic>."*
- *"Turn my last devlog into an X thread."*

Claude drafts in your voice, shows every tweet numbered with its live weighted
character count (`[3/7 · 262/280]`), and on your OK runs the publish step —
single post or reply-chained thread.

## X-specific rules baked in

- **280 weighted characters per tweet, enforced before preview.** URLs always count
  23, most emoji/CJK count 2 — `scripts/x_len.py` implements the twitter-text rules
  (conservatively: if it passes here, it fits on X).
- **The first tweet is the hook.** There is no "…see more" fold on X; tweet 1 must
  stand alone and earn the tap. `voice/algorithm.md` carries the reach mechanics.
- **Links go in a reply, not tweet 1** — external links in the main post suppress reach.
- **Threads over long-form.** Threads are the native long format; the skill steers
  toward ≤7 tweets and can resume a half-posted thread after a rate limit
  (`x_post.py --resume`).

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
| `scripts/x_auth.py` | One-time OAuth 2.0 PKCE; writes tokens + user id to `.env` |
| `scripts/x_post.py` | Publishes a post or thread (`--dry-run` to preview, `--resume` after 429) |
| `scripts/x_len.py` | Weighted 280-character validation (twitter-text rules) |
| `scripts/extract_tweets.py` | Turns your archive's `tweets.js` into clean text for voice analysis |
| `scripts/verify_sources.py` | Source gate: every external claim needs ≥3 live distinct hosts |
| `scripts/post_outcome.py` | Records how a published post did (self-reported) |
| `scripts/render_image.py` / `render_carousel.py` / `card_lint.py` | 16:9 card rendering + lint |
| `assets/` | Landscape card templates, card language, vendored `mermaid.min.js` |
| `voice/*.example.md` | Templates — copy to `voice/interests.md` / `voice/voice-notes.md` |
| `drafts/`, `research/`, `images/` | Generated drafts, radar digests & visuals (gitignored) |

## Security

- All secrets live in `.env` (gitignored); `.env.example` ships placeholders only.
- Your tweet archive (`data/`), drafts, digests, and filled-in voice files are gitignored.
- The core (auth + posting + validation) is Python 3 **standard library only**. The
  optional card feature is the one exception (Playwright + Chromium in a local `.venv`).

## Notes & limits

- Access tokens expire after **2 hours**; `x_post.py` refreshes automatically using
  the rotating refresh token. If auth is ever wedged (`invalid_grant`), rerun
  `python3 scripts/x_auth.py`.
- **Review-then-publish is permanent, not a v1 limitation.** X's developer terms
  allow API posting on your own behalf, but this skill never posts unattended —
  a human approves every tweet. See [`COMPLIANCE.md`](COMPLIANCE.md).
- Outcome tracking is self-reported (free-tier read access is effectively nil);
  the skill asks how a post did a couple of days later and learns from that.
- Each person runs their **own** X developer app and posts only to their **own**
  account.
