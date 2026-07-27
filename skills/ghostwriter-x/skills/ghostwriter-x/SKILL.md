---
name: ghostwriter-x
version: 0.1.0
user_invocable: true
description: Write sharp X (Twitter) posts and threads in the user's own voice and publish them via the X API after they approve. Use when the user wants to draft, write, or post something to X or Twitter, asks for a "tweet", a "thread", or an "X post", or wants to set up X posting. Enforces X's 280-weighted-character limit per tweet, formats threads natively, and never publishes without explicit approval.
---

# ghostwriter-x

X (Twitter) sibling of the LinkedIn `ghostwriter` skill. Full instructions land in
Phase 3 of the initial build; this stub establishes the skill's contract.

## Modes

- **Setup** — OAuth 2.0 PKCE via `scripts/x_auth.py`, voice corpus via
  `scripts/extract_tweets.py` (or seeded from the LinkedIn ghostwriter profile).
- **Generate** — idea lanes → hook-first draft → weighted 280-char validation per
  tweet (`scripts/x_len.py`) → source-verification gate → approval.
- **Publish** — `scripts/x_post.py` (single or thread, `--dry-run` first). Never
  publish without explicit approval.
