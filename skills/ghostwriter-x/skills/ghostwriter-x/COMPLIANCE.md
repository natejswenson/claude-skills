# X API compliance notes

A plain-English record of how this tool stays within X's
[Developer Agreement and Policy](https://developer.x.com/en/developer-terms/agreement-and-policy).
**Not legal advice** — read the terms yourself. The design intentionally hugs the
conservative side.

## The key difference from the LinkedIn sibling

LinkedIn's API terms ban automated posting outright; this skill's LinkedIn sibling
exists under a narrow member-initiated carve-out. **X is different: posting via the
API on your own authenticated account's behalf is exactly what the API is for.**
OAuth 2.0 user-context write access (`tweet.write`) is a sanctioned, first-class
capability.

That said, this skill keeps the same human-in-the-loop design anyway:

- A human reviews the exact text of every tweet (each tweet of a thread, with its
  weighted character count) before anything publishes.
- A human explicitly approves before anything publishes. One post per request.
- **No unattended, scheduled, looped, or bulk posting.** Not because X forbids
  API posting — but because X's platform-manipulation and spam rules DO forbid
  bulk/duplicative/deceptive automation, because unreviewed AI text posted to a
  real account is a reputational hazard, and because the account is the user's
  professional identity. This is a product decision as much as a compliance one.

**Hard rule for this repo: never add fully autonomous / scheduled posting.** If the
user asks for it, decline and explain this file.

### Scheduled *research* is fine; scheduled *posting* is not

The **release radar** (`scripts/release_radar.sh`, run twice weekly by a launchd
agent) only reads public web sources and writes a local digest to `research/`. It
never calls `scripts/x_post.py` and never touches the X API. A human still picks an
item, reviews the draft, and approves it before anything posts.

## How the design maps to X's rules

| Requirement | Our approach |
|---|---|
| Platform manipulation / spam rules — no bulk, aggressively duplicative, or deceptive posting | One human-approved post per request; duplicate-content is a documented anti-pattern (`voice/algorithm.md`); thread posts are chained replies to the user's own post. |
| No scraping | Voice data comes from the user's own **account archive download** (`data/tweets.js`), never from scraping x.com. Trending research uses public non-X surfaces (HN, news) plus the user's own interests. |
| Rate limits | The post script surfaces 429s with the reset time and a `--resume` path instead of retry-hammering. Legacy free tier ≈ 500 posts/month (~17/day) at the app level; threads are steered to ≤7 tweets. |
| Automation disclosure | This is user-initiated, user-approved posting from the user's own account — not an automated/bot account under X's automation rules. If the account ever became bot-like (unattended posting), X requires labeling it; we simply never cross that line. |
| Credentials | OAuth 2.0 Authorization Code + PKCE only; we never see the password. Tokens live in `.env` (chmod 600, gitignored). Refresh tokens rotate; both current and previous are stored locally only. |
| Other users' content | We never read, store, or repost other users' content via the API. Write-only usage plus `/2/users/me`. |

## Why the outcome loop is self-reported

The skill asks the user how a post did (`scripts/post_outcome.py`) instead of
reading metrics from the API. Free-tier read access is effectively nil (roughly
1 request/15 min on the legacy free tier; accounts on 2026 pay-per-use pricing pay
per read), and scraping x.com for your own analytics is still scraping. Self-report
keeps the feedback loop compliant and free. If the user has paid API read access,
this could be revisited — as an explicit, user-initiated fetch, not a scheduled job.

## Things that would BREAK the rules — do not do these

- **Unattended / scheduled posting** (product hard rule; also drifts into X's
  automation-labeling and spam territory).
- **Bulk or duplicative posting** — same text to multiple posts, mass-posting,
  trend-jacking with unrelated content (platform-manipulation policy).
- **Scraping x.com** for voice data, topics, or analytics. Use the archive export
  and the official API only.
- **Multiple apps** to dodge rate limits.
- **Letting other people post through your app** — each person runs their own X
  developer app against their own account.

## Token & data hygiene

- Access tokens expire after ~2 hours; `x_post.py` refreshes automatically via the
  rotating refresh token. If auth wedges (`invalid_grant`), re-run
  `scripts/x_auth.py`.
- On account closure or if you stop using the tool, delete
  `~/.claude/ghostwriter-x/.env`.
- `data/` (your archive) and `drafts/` stay local and gitignored — personal data
  never leaves your machine.
