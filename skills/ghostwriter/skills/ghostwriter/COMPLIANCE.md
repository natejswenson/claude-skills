# LinkedIn API compliance notes

A plain-English record of how this tool stays within LinkedIn's
[API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use). **Not legal
advice** — read the terms yourself. The design intentionally hugs the conservative side.

## The load-bearing rule: §3.1 "do not automate posting"

> *"Use the Content or the APIs to automate posting on the LinkedIn Services."* — §3.1

We read this as a ban on **unattended / bot-driven / bulk posting without per-post member
action**, not a ban on the sanctioned "Share on LinkedIn" product (which LinkedIn provides
expressly to "post on behalf of an authenticated member"). The clause is genuinely ambiguous
and LinkedIn enforces aggressively, so this tool stays on the safe side by making **every post
member-initiated and member-approved**:

- A human reviews the exact text of every draft.
- A human explicitly approves before anything publishes.
- One post per request; no scheduled, looped, or unattended **posting**.

**Hard rule for this repo: never add fully autonomous / scheduled posting.** Removing the human
approval step is the one change that would turn this from defensible into a likely violation.

### Carve-out: scheduled *research* is fine; scheduled *posting* is not

The §3.1 ban is on automated **posting**. Automated **research** that only reads public web
sources and writes a local file is not posting and does not touch LinkedIn at all. The
**release radar** (`scripts/release_radar.sh`, run twice weekly by a launchd agent) is exactly
this: it web-searches Anthropic/Claude Code release sources and writes a digest to `research/`.
It never calls `scripts/linkedin_post.py`, never hits the LinkedIn API, and never publishes. A
human still picks an item, reviews the resulting draft, and approves it before anything posts.
If the radar ever gained the ability to post on its own, that would break this rule.

## How the rest of the design maps to the terms

| Requirement | Our approach |
|---|---|
| §3.1 — no scraping/crawling LinkedIn content | Voice data is the user's own **"Get a copy of your data" export**, not scraped. |
| §3.1 — no collecting usernames/passwords | OAuth 2.0 only; we never see the password. |
| §3.1 — pre-filled content must be editable by the member | Every AI draft is shown and is fully editable / refusable before posting. |
| Images on posts | Uploaded via the official Images + Posts API; optional, member-approved per post; rendered fully locally (nothing sent to third parties); carry alt text and must not misrepresent facts. |
| §3.1 — no impersonation | Posts are the member's own content from their own authenticated account. |
| §1.4 — self-serve eligibility | Single user, not advertising, not business-critical, well under call limits. |
| §4.2 — may store OAuth token + Member Token | We store only the access token + person URN, locally in `.env`. |
| §7.1 — security / encryption at rest | `.env` is `chmod 600`, gitignored. Don't commit or share it. |

## Things that would BREAK compliance — do not do these

- **Autonomous / scheduled posting** with no human approving each post (§3.1).
- **Letting anyone else use this app**, which triggers §5.1 (your own privacy policy + user
  agreement), §5.2 (member consent flows), and §7.1 (security questionnaire) obligations. Keep
  it a single-user personal tool. (Note: *open-sourcing the code* is fine — that's distinct.
  Each person who clones it creates their own LinkedIn app and posts only to their own profile,
  so each install stays single-user. The line you must not cross is many members posting through
  one app.)
- **Scraping** LinkedIn (profiles, posts, connections) to gather voice data or topics (§3.1).
  Always use the official data export instead.
- **Creating multiple apps** for the same purpose to dodge limits (§3.1).
- **Posting on a schedule/volume** that looks like a bot (stay low-volume and human-paced).
- Storing or reusing **other members' data** pulled from the API (§4).

## Token & data hygiene

- Access tokens expire ~60 days; re-run `scripts/linkedin_auth.py` to refresh. On account
  closure or if you stop using the tool, delete `.env` (§4.4/§4.5).
- `data/` (your export) and `drafts/` stay local and gitignored — personal data never leaves
  your machine.
