# X reach optimization (apply to every post)

Evidence-based, current as of 2026. X ranks with an engagement-prediction model
(the open-sourced heavy ranker plus continual tweaks): the "For You" feed is
interest-matched, not follower-gated, so a single post can massively outrun your
follower count — or die unseen — based on its first minutes of engagement signals.
**These rules must never override `voice-notes.md`** — where they conflict, voice-notes
wins.

## How distribution works (why tweet 1 decides everything)
1. Your post is scored for predicted engagement and shown to a slice of followers
   and interest-matched non-followers.
2. Early replies, dwell, and profile clicks in the **first ~30–60 minutes** expand
   (or end) distribution.
3. There is **no fold and no "…see more"**: the whole tweet is the hook. In the
   timeline, the first ~100–140 characters and any image do the stopping; the rest
   earns the reply or the tap into the thread.

## Engagement signals by weight — optimize for the top
- **Replies (and reply chains you participate in) are the strongest signal.** A post
  that starts a real conversation beats one that gets silent likes.
- **Dwell + "show more" taps on threads** — a thread that keeps people reading
  compounds; each tweet in the chain is another chance to surface.
- **Profile clicks and follows** off the post signal author quality.
- Reposts/quotes, then likes (baseline), then impressions.
- **Never engagement-bait** ("repost if…", "like for part 2") — the model demotes it
  and voice-notes forbids it anyway.

## Bake into every draft
- **Tweet 1 must stand alone AND earn the tap.** The sharpest number, tension, or
  claim goes in the first line. If tweet 1 reads like a preamble, cut it and start
  at tweet 2.
- **No external links in the main post.** Links in tweet 1 measurably suppress
  reach (X deprioritizes off-platform exits). Put the link in the **last reply** of
  the thread ("link below" if you must reference it).
- **Threads > long-form for anything that doesn't fit one tweet.** Chained replies
  are the native long format: each tweet a complete beat, numbered when it helps
  (`3/7`), ≤7 tweets by default. Never split mid-sentence across tweets.
- **Native images beat link cards.** A composed 16:9 card (1200×675) stops the
  scroll; up to 4 images make a carousel-like post. Always with alt text.
- **Specifics over abstractions.** Real commands, real numbers, real names — that's
  what gets bookmarked and quoted.
- **Plain, human, punchy.** Short sentences. No hashtag soup (0–2 max, usually 0 —
  hashtags read as spam on X now). No "🧵👇" clichés unless the voice profile says
  otherwise.
- **280 weighted characters per tweet, hard.** URLs count 23; most emoji/CJK count
  2. The scripts enforce it (`scripts/x_len.py`); write to fit, don't trim at the
  gate.

## Posting behavior (the user's actions — the skill can't do these, so prompt for them)
- **Reply window:** for 30–60 minutes after posting, reply to every substantive
  response with substance (a question back, not "thanks"), and quote-or-reply to a
  couple of adjacent conversations. Reply chains are the #1 lever.
- **Cadence:** consistency beats bursts; 1–3 posts/day is plenty. Don't
  delete-and-repost (it resets scoring), and don't post near-duplicates —
  duplicate-content suppression is real.
- **Post when your audience is awake** (check your own analytics; weekday mornings
  US time is a common default for dev audiences).

## Honest caveat
Optimization raises the ceiling; it can't manufacture an audience. Small accounts
grow through consistent posting, real conversation in other people's threads, and
hooks legible outside their niche — not through any single-post tweak.
