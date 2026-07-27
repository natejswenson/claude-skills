# Compliance notes (X via Typefully)

A plain-English record of how this tool stays inside the rules. **Not legal
advice** — read the terms yourself. The design intentionally hugs the
conservative side.

## How posting works here

This skill does not talk to X's API at all. X removed its free tier in
February 2026 (new developer accounts are pay-per-use), so publishing goes
through **Typefully** — an established scheduling product whose entire business
is posting to X on its users' behalf through X's official partner/API
arrangements. The user connects their X account to Typefully in Typefully's own
UI (Typefully handles the X authorization), and this skill drives Typefully's
public API with a personal API key.

That means the compliance surface splits in two:

- **X's rules** are Typefully's to satisfy at the API level — that's their
  product. What remains ours: don't be a spammer *through* them (platform
  manipulation rules apply to the account's behavior regardless of the tool).
- **Typefully's terms** apply to our API usage: personal automation is an
  advertised use of their public API; their rate limits and plan limits
  (free plan ≈ 1 social set, ~15 posts/month) are enforced server-side and
  surfaced honestly by `scripts/typefully_post.py` (401/402/429 handling).

## The human-in-the-loop design (unchanged, and non-negotiable)

- A human reviews the exact text of every tweet (each tweet of a thread, with
  its weighted character count) before anything publishes.
- A human explicitly approves before anything publishes. One post per request.
- **No unattended, scheduled, looped, or bulk posting.** Typefully *offers*
  scheduling; this skill deliberately publishes only `publish_at: "now"` after
  a per-post human approval. Unreviewed AI text on a real account is a
  reputational hazard, and bulk/duplicative automation is exactly what X's
  platform-manipulation rules prohibit.

**Hard rule for this repo: never add fully autonomous / scheduled posting.**
If the user asks for it, decline and explain this file.

### Scheduled *research* is fine; scheduled *posting* is not

The **release radar** (`scripts/release_radar.sh`, run twice weekly by a
launchd agent) only reads public web sources and writes a local digest to
`research/`. It never calls `scripts/typefully_post.py` and never touches
Typefully or X. A human still picks an item, reviews the draft, and approves
it before anything posts.

## Other rules we keep

| Requirement | Our approach |
|---|---|
| No scraping x.com | Voice data comes from the user's own **account archive download** (`data/tweets.js`). Trending research uses public non-X surfaces (HN, news) plus the user's own interests. |
| No spam / duplicative posting | One human-approved post per request; duplicate content is a documented anti-pattern (`voice/algorithm.md`). |
| Credentials | One Typefully API key in `.env` (chmod 600, gitignored). No X password, no X tokens on this machine at all. Revoke any time at typefully.com → Settings → API. |
| Other users' content | Never read, stored, or reposted. The API usage is write-only plus listing the user's own social sets. |

## Why the outcome loop is self-reported

The skill asks the user how a post did (`scripts/post_outcome.py`) instead of
reading metrics: X analytics aren't part of Typefully's free API surface, and
scraping x.com for your own numbers is still scraping. Self-report keeps the
feedback loop compliant and free.

## Things that would BREAK the rules — do not do these

- **Unattended / scheduled posting** (product hard rule — see above).
- **Bulk or duplicative posting** — same text to multiple posts, mass-posting,
  trend-jacking with unrelated content.
- **Scraping x.com** for voice data, topics, or analytics.
- **Sharing the Typefully API key** or letting other people post through the
  user's account.

## Key & data hygiene

- The API key lives only in `~/.claude/ghostwriter-x/.env`. If you stop using
  the tool, delete the key at typefully.com and delete `.env`.
- `data/` (your archive) and `drafts/` stay local and gitignored — personal
  data never leaves your machine except the approved post text sent to
  Typefully to publish.
