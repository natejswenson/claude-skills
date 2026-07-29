---
name: ghostwriter-x
version: 0.2.0
user_invocable: true
description: Write sharp X (Twitter) posts and threads in the user's own voice and publish them through the free Typefully API after they approve. Use when the user wants to draft, write, or post something to X or Twitter, asks for a "tweet", a "thread", or an "X post", or wants to set up X posting. Enforces X's 280-weighted-character limit per tweet, formats threads natively, and never publishes without explicit approval.
---

# X Ghostwriter

Draft X posts and threads that sound like the user, then publish to their own account
through the Typefully API (free plan — X's own API has no free tier anymore) — **only
after they approve the draft**. Never auto-publish.

The repo root is the directory containing this skill's `scripts/`, `voice/`, and `drafts/`
folders. All commands below are run from that repo root.

**Personal data lives in `~/.claude/ghostwriter-x/`, not the repo.** The voice profile
(`voice/voice-profile.md`, `voice-notes.md`, `interests.md`), the brand guide
(`assets/diagram.css`), and the Typefully credentials (`.env`) are read from
`~/.claude/ghostwriter-x/{voice,assets,.env}` — the same location whether the skill is running
from this repo, an installed Claude Code plugin, or Claude Desktop, so editing your voice or
brand once is visible everywhere. `voice/algorithm.md` (X reach tuning) stays bundled in the
repo — it's shipped, identical content, not personal. `data/`, `drafts/`, `images/`, `scripts/`
also stay repo-local since they're tied to running the actual publish flow from one place.

**Sibling skill:** the LinkedIn `ghostwriter` skill shares this architecture but not this
platform. If the user asks for a LinkedIn post, that skill handles it, not this one.

## Decide which mode you're in

- **Setup** — `~/.claude/ghostwriter-x/.env` has no `TYPEFULLY_API_KEY`, or
  `~/.claude/ghostwriter-x/voice/voice-profile.md` is missing, or the user says "set up",
  "configure", "connect my X account". → Run **Setup**.
- **Generate** — the user wants a post or thread (the common case). → Run **Generate**.
- **Publish** — the user approves a draft you already showed. → Run **Publish**.
- **Check in** — the user asks how a post or their posts did ("how did my posts do?", "how did
  that thread go?"). → Run just the **Outcome check-in** at the top of Generate, record the
  answer, and stop. Don't slide into drafting a new post unless they ask.

Before generating, quietly confirm setup is done: `~/.claude/ghostwriter-x/voice/voice-profile.md`
exists and `~/.claude/ghostwriter-x/.env` contains `TYPEFULLY_API_KEY` + `TYPEFULLY_SOCIAL_SET_ID`.
If not, switch to Setup.

**Keep this invisible.** Do the setup check (and any other bookkeeping — idea-board/radar
freshness, directory orientation) in as few, terse tool calls as possible: one chained
existence/content check, not a parade of separate `Bash` calls with printed section headers.
Skip exploratory commands that don't feed an immediate decision (a bare `pwd`, an `ls` "just to
look around"). The first thing the user should see is your one-sentence status line, not a
scroll of raw command output. This doesn't apply to the real research in Generate step 2 (the
HN check, radar read, `recent_projects.py`) — that work produces content the user actually sees
reflected in the menu.

---

## Mode: Setup

Walk the user through this once. Do the steps you can; hand them the steps only they can do.

1. **Typefully account.** Publishing goes through Typefully's API because X's own API has
   no free tier (pay-per-use since Feb 2026). Ask them to sign up at
   <https://typefully.com>, **connect their X account** in Typefully's UI, and create an
   API key (**Settings → API**). The free plan covers 1 social set and ~15 posts/month —
   plenty for a personal cadence; mention the cap if they post daily.
2. **.env.** Run `mkdir -p ~/.claude/ghostwriter-x && cp .env.example ~/.claude/ghostwriter-x/.env`,
   then write their API key into `~/.claude/ghostwriter-x/.env` as `TYPEFULLY_API_KEY`
   (edit the file; never echo the key back in chat).
3. **Connect.** Run `python3 scripts/typefully_post.py --connect` — it fetches their
   Typefully social sets and stores `TYPEFULLY_SOCIAL_SET_ID` in `.env`. One-time; no
   OAuth dance, no token expiry.
4. **Voice corpus — pick whichever the user can do fastest:**
   - **X archive (best).** Request it from X (Settings → *Your account* → *Download an
     archive of your data*; it can take a day to arrive). Drop the archive's `data/tweets.js`
     into `data/`, then run `python3 scripts/extract_tweets.py` and do the **Voice Profile**
     step below on `data/my_posts.md`.
   - **Seed from the LinkedIn ghostwriter (fast start).** If
     `~/.claude/ghostwriter/voice/voice-profile.md` exists, offer to derive the X profile from
     it: keep the voice DNA (tone, vocabulary, never-do list) but shift the register for X —
     shorter sentences, hook-first, no corporate polish, fragments welcome. Show the user the
     derived profile and confirm before saving. Mark it as seeded so a later archive import
     can replace it.
   - **Interview (no data at all).** Ask about tone, the 3–5 topics they're known for,
     formatting habits (emoji? all-lowercase? threads or singles?), and what they never want
     to sound like.
5. **Interests & voice notes.** If they don't exist yet (e.g. a fresh clone), seed them from
   the templates: `mkdir -p ~/.claude/ghostwriter-x/voice && cp voice/interests.example.md
   ~/.claude/ghostwriter-x/voice/interests.md` and `cp voice/voice-notes.example.md
   ~/.claude/ghostwriter-x/voice/voice-notes.md`. Then help them fill in
   `~/.claude/ghostwriter-x/voice/interests.md` (interview them if it's empty; if the LinkedIn
   ghostwriter's `interests.md` exists, offer to copy it as the starting point — interests
   usually transfer even when register doesn't). `voice-notes.md` ships with sensible
   defaults; append the user's own feedback to it as it comes up.

### Voice Profile (the heart of "sounds like me")

Read `data/my_posts.md` in full, then write `~/.claude/ghostwriter-x/voice/voice-profile.md`
(`mkdir -p ~/.claude/ghostwriter-x/voice` first if it doesn't exist yet) capturing:

- **Voice & tone** — e.g. direct, contrarian, warm, wry. Quote 2–3 tweets that exemplify it.
- **Sentence rhythm** — one-liners? multi-clause? fragments for emphasis? all-lowercase?
- **Openers** — how do their best tweets hook in the first line? (bold claim, number, story
  cold-open, question). List the patterns they actually use.
- **Closers** — do they end threads with a takeaway, a question, a link reply, nothing?
- **Structure** — singles vs threads; numbered threads (`3/7`) or free-form; line breaks
  within tweets.
- **Vocabulary & tics** — recurring phrases, signature words, how they swear or don't.
- **Emoji & hashtags** — none / sparing / heavy; which ones; where. (Most strong X accounts:
  no hashtags.)
- **Topics they own** — the themes they return to.
- **Never do** — anti-patterns to avoid (engagement bait, "🧵👇", corporate buzzwords,
  em-dash overuse, fake vulnerability, generic AI-slop phrasing). Be specific to *this* person.

Keep it concrete and example-driven — it's a generation guide, not an essay.

---

## Mode: Generate

**Posture: propose, don't interrogate.** The default is *you* surface concrete, already-real
ideas and the user taps one — not a blank "what do you want to post about?" The picked idea is the
post's real anchor, so there's no generic interview.

**Outcome check-in (max one, fast — the feedback loop).** Before anything else, run
**`python3 scripts/post_outcome.py --check-due`**. It prints `none`, or the one record a check-in
is owed on. Do not hand-roll this from the log: the script picks the **oldest unscored post at
least 2 days old**, which is the whole point. (The pre-0.2.0 rule asked about the *newest* record,
so posting twice in one day left the newest record same-day forever, the gate never opened, and
ripe older posts were never offered — the loop sat dead through three published posts. If you
re-derive the rule by hand you will reintroduce that bug.)

If a record comes back, ask ONE check-in question — *"How did '<first_line>' do?"* with options
great / normal / flopped (notes via "Other") — then record it:
`python3 scripts/post_outcome.py --due --outcome <answer> --notes "<notes>"`. **One dialog to
start: if the idea menu (step 2) is also due, the check-in and the menu ride in the SAME single
`AskUserQuestion` call** — the check-in takes the first question slot and the flat idea question
(step 2) takes the second — still one dialog, one round trip, never two sequential question
dialogs to get a session moving. Only when no menu is due (the topic came in concrete)
may the check-in be its own question. Never ask more
than once per session; `none` → skip silently, don't mention it.

Posts older than **30 days are never asked about** — nobody honestly remembers, and a guess is
worse than a gap. `python3 scripts/post_outcome.py --retire-stale` marks those `unrecalled` so the
backlog stops growing; run it when `--check-due` has been returning `none` for a while.

**Using the outcomes — and the sample-size bar.** This is a self-reported signal on a handful of
posts with no control group. Treat it as a record you can show the user, not a measurement you can
optimize against. The confounds here are *unidentifiable*, not merely noisy: every post varies
lane, hour, format, image and hook at once, so there are more free variables than observations,
and format is collinear with content **by construction** because the agent picks thread-vs-single
from the content's shape — "threads do better" may only mean "meatier topics do better".

- **Fewer than 5 scored posts → display only.** You may show the user their own numbers and use
  them to avoid repeating a topic. **Zero influence on ranking.**
- **≥5 in an arm** → you may *say* what you see, with the N attached ("3 of your 4 threads beat
  your 2 singles, small sample"). No behaviour change.
- **≥8 in each of two arms AND a ≥2× gap** → move a lane by **one** position, stating the N.
  Never drop a lane entirely.
- **Single vs thread is never outcome-driven.** Content shape decides, always.
- **Posting time is never outcome-driven.** The per-hour sample will not exist for years.
- Compare **medians, not means** — one amplified post swamps a small account's average — and
  ignore anything older than **90 days**; X's ranking and the follower base both move.

**Anti-ratchet — the loop's real hazard.** Outcomes must **never** override
`voice-notes.md`, the substance bar, or the source gate. They sit *below* those in precedence,
exactly as `algorithm.md` does. A `flopped` on an honest, well-sourced post is not a reason to
change the voice; chasing a reach number on a personal account is precisely the pressure that
bends a technical voice toward the engagement bait this skill forbids. If the data ever seems to
argue for a banned tactic, the data loses.

This is the only **free** compliant performance signal available. Be precise about why: real
analytics are **paywalled, not forbidden**. Typefully's `list_social_set_analytics_posts` and
`get_social_set_analytics_followers` are official, COMPLIANCE-clean endpoints that return
`403 MONETIZATION_ERROR` on the free plan (verified 2026-07-27) — don't re-probe them every
session. If the user ever wants real numbers sooner, the zero-cost path is for **them** to read
their own x.com analytics and paste the figures in; the agent never fetches x.com, so that is not
scraping. Revisit the whole loop if the account upgrades.

1. **Short-circuit if the topic is already concrete.** If the user named a specific topic, pointed
   you at a source, or said "draft a post from item N in the radar," skip the menu and go straight
   to grounding + drafting (step 3). The menu below is the default only for an open-ended "write me
   a post."
2. **No topic given → ONE flat idea question, pick and go.** Gather concrete, ready-to-write
   ideas from the four lanes below *yourself*, then **flatten them into a single ranked list**
   (lane priority order below, bent by outcome history) and present the **top 3** as **ONE
   single-select `AskUserQuestion`** — options are the 3 ideas plus a 4th, **"Show more
   ideas."** Never ask one question per lane. Rules of the question:
   - **Every idea option carries a `preview`** (≤ ~9 lines so the pane never clips): the working
     tweet as it would actually read, the suggested angle in one sentence (assume a single
     unless the user asked for a thread), and a source-freshness line prefixed with its
     lane (e.g. `Trending · HN 612 pts / 340 comments · Jul 18`, `Radar · Jul 17 ·
     anthropic.com`). A user should be able to pick on the preview alone.
   - **Picking a real idea goes straight to grounding + draft (step 3) — nothing else to answer
     or dismiss.** The auto "Other" on the question takes a typed topic directly (same
     short-circuit as step 1).
   - **Picking "Show more ideas" asks exactly ONE follow-up single-select question** with the
     next batch (the remaining candidates, up to 3 + auto "Other"), same preview format.
   - **One provenance line total in chat**, not per lane (radar date + job health, live-search
     date, repo names) — don't dump a duplicate board into chat; the question options carry the
     ideas.
   - **When the outcome check-in is due** it rides as the first question in the SAME call (see
     above); the flat idea question is the second. Still one dialog, one round trip.

   The four lanes, in priority order (used to rank the flattened list, not to structure separate
   questions):
   - **Trending now (live, run-day — VERIFIED trending, not vibes).** "Trending" means you can
     point at the surge, not that a web search returned articles; vendor blogs and SEO listicles
     are not trending signals. Check measurable surfaces directly, TODAY: **Hacker News via
     `python3 scripts/hn_trending.py`** (defaults to the last 2 days over 150 points; `--days`,
     `--min-points`, `--json` if you need them). **Use the script, not a hand-written curl** — the
     Algolia filter needs `points>150,created_at_i>…` percent-encoded, and in a shell the `>`
     redirects to a file and the query silently returns nothing (this cost a wasted round trip on a
     real run). Then **top posts this week** in the relevant subreddits, and **news coverage from the last
     ~48 h** (search with explicit recency). Filter through the trending areas in
     `~/.claude/ghostwriter-x/voice/interests.md`, propose **2–3 topics**, each with the specific
     angle the user could own (a trending topic without their angle is just news), and put the
     ACTUAL signal in the preview's source line. X moves faster than LinkedIn: a surge older
     than ~24 h is usually already picked over — prefer today's signal, and say so when an item
     is borderline stale. No citable signal → the item doesn't go in the lane; fewer real
     trending items beat padded ones.
   - **Release radar — current through TODAY, not through the last digest.** Read the newest
     `research/release-radar-*.md` and, **if it exists**, the tail of `research/.radar.log`, and
     state provenance in the board ("Jul 24 radar, job ran clean"). The log is only created once
     the launchd job has run on this machine — **absent means "job never ran here", which is not
     the same as "job failed"**; say which one you actually know and don't spend a second call
     hunting for it. **If the digest is older than today, top the lane
     up**: one quick live search for AI releases since the digest date — label digest items
     `radar · <date>` and top-ups `live · today`. Reuse digest items' title + "suggested angle"
     (already source-backed; the twice-weekly `scripts/release_radar.sh` job scans the broader AI
     industry, not just Anthropic). Never add experience claims the digest didn't establish; the
     digest's **Discussion radar** items feed opinion/hot-take slots the same way. Skip items
     already published (check `published.jsonl`). **Radar stale (>4 days) or missing** → say so,
     note whether the log shows the job failing, and run the lane fully live; if the job is broken
     (e.g. exit 127 — usually the repo moved), offer to repair it: `bash scripts/install_radar.sh`
     re-renders the launchd agent against the repo's current path.
   - **Interests & hot takes (1–3 entries).** Read `~/.claude/ghostwriter-x/voice/interests.md` —
     core themes, the "Strong opinions" list, and the story bank — for specific angles not
     covered recently (check `published.jsonl` and recent drafts). A strong uncovered story-bank
     item beats a generic theme; hot takes are X's home turf, so weight this lane a notch higher
     than the LinkedIn sibling does; label each `interests · <theme or story>`.
   - **Your recent Claude projects (2–3 entries).** Run `python3 scripts/recent_projects.py` and
     take the top 2–3 repos with recent Claude Code sessions; for each, read the recent `git log`
     + last session summary for the **one real thing shipped** (that's the anchor). Respect
     `~/.claude/ghostwriter-x/voice/interests.md` → **Off-limits**: never surface or post anything
     work-confidential; personal/OSS repos only.

   **Build the list fast and honestly.** Gather all four lanes in parallel (the HN check, the
   radar read + top-up, interests, `recent_projects.py`) so the question is the first thing the
   user waits on. An idea appears in exactly ONE lane — highest-signal lane wins. Filter every
   candidate against `published.jsonl` and recent `drafts/` so nothing already covered
   resurfaces. Rank the flattened list by lane priority and the outcome history, and say so in
   the provenance line when it bends the order.

   **Persist the full list — research the user paid for doesn't evaporate.** Whether or not it
   was shown, write `research/idea-board-YYYY-MM-DD.md`: every idea gathered (not just the 3
   surfaced) with its lane, signal, angle, and status. Status is one of **`published · <url>`**,
   **`drafted · <slug>`**, or **`on deck`** — never a bare `picked`, which records an intention
   rather than an outcome and goes stale the moment the session ends. (A real board carried three
   items marked `picked` that were never drafted, so the next run could not tell covered ground
   from abandoned ground.) **Reconcile before you trust a board**: an item is only `published` if
   `published.jsonl` has it, and only `drafted` if the file is in `drafts/`; downgrade anything
   else back to `on deck`. On the next open-ended run, read the newest board (≤7 days old) and
   fold still-good `on deck` ideas back into the flattened ranking labeled `on deck · <date>` —
   re-verify a trending idea's signal before reusing it, and drop anything that went stale.

   **After the pick: lock it in, zero extra dialogs.** Echo a compact brief and go —
   `Locked in: <idea> · <lane>`, then one line each for the angle, the real anchor, the form
   (a single unless the user asked for a thread), and the sources you'll verify against. Then straight to
   grounding + draft (step 3); no second drill.
3. **Confirm the anchor, then draft.** Every post still needs **one concrete, real, first-person
   anchor** — the actual tool, a real number, a specific decision, a thing that actually happened
   (see voice-notes.md → Substance bar + Authenticity). The menu pick normally *is* that anchor.
   Only the personal-project lane sometimes needs a single sharp follow-up to nail the specific
   detail — ask **one** `AskUserQuestion`, never a generic multi-question interview. **Never
   fabricate a detail to clear this bar.** If there's genuinely no real anchor, say so rather than
   shipping a generic post.

   **3a. Run it before you write about it — the highest-leverage step in this skill.** A release
   how-to assembled from documentation is a recap anyone could write. The same post built on a
   real run is an artifact only this user has. Before drafting, spend the two or three calls to
   check whether the thing is *runnable from this session*:
   - **Is the tool reachable?** `uvx <pkg>@<version>`, `npx -y <pkg>@<version>`, `pipx`, `docker
     run`, an already-installed binary, or an MCP tool the session has. Pin the exact version the
     post is about, and the version *before* it when the post is about a change.
   - **Verify the mechanism against the real binary, not the docs.** Run `--help`, check that the
     flags and defaults you're about to publish actually exist. Docs drift; a shipped post that
     names a flag that isn't there is the most embarrassing failure mode this skill has.
   - **Measure a real before/after when there is a legitimate subject.** `scripts/recent_projects.py`
     lists the user's own repos; running an analysis command over one turns "the default set grew"
     into "9 errors became 138 on the same code." That number is the post.
   - **Read-only, always.** Analysis and reporting commands only — linters, `--help`, `--dry-run`,
     `--check`, read queries. Never a command that writes, installs into, or mutates the user's
     repos, and never anything in a work-confidential repo (interests.md → Off-limits).
   - **Capture what you ran** to `images/<slug>.source.txt` even when no card is planned; it is
     the evidence behind the numbers and `card_lint.py` verifies cards against it.
   - **When it isn't runnable, say so and write generically** — steps in the second person, no
     invented results. A how-to that can't be run is still fine; a fabricated run is not.

   **3b. Whose run was it? — the disclosure rule.** Measurements from step 3a were produced by
   *you*, in this session, not by the user at their keyboard. First-person framing ("I ran…", "my
   repo", "my CI never moved") is **only** allowed when both hold: the command ran against the
   user's own machine or repos, **and** you state the provenance plainly at the approval step
   ("these are real measurements, but I ran them in this session — you didn't"). Let the user
   decide; some will happily own it, some won't. **Default to second person** ("run this on your
   repo") whenever you haven't disclosed it, and **never** use first person for a run on a machine
   or repo that isn't theirs. Everything else in Authenticity still applies: no invented numbers,
   ever.
4. **Draft against the voice profile.** Read `~/.claude/ghostwriter-x/voice/voice-notes.md`,
   `~/.claude/ghostwriter-x/voice/voice-profile.md`, AND `voice/algorithm.md` (bundled,
   repo-relative) first, every time (voice-notes.md holds direct user feedback and takes
   priority; algorithm.md is reach optimization and must never override voice). If a voice file
   is missing — e.g. a fresh setup — copy `voice/voice-notes.example.md` to
   `~/.claude/ghostwriter-x/voice/voice-notes.md` and proceed with what you have. Write to match
   them — their openers, rhythm, emoji habits, thread style. Apply the **Engagement craft**
   rules below AND the reach rules in `voice/algorithm.md`. Format rules:
   - **A SINGLE tweet is the default form. Draft a thread only when the user asks for one.**
     Material with five beats is a signal to find the sharpest beat and cut the other four,
     not to thread it; a punchy single is the house style, and the beats that don't survive
     the cut are exactly what a card is for (step 8). When the user does ask for a thread:
     complete-thought tweets, ≤7 by default, never a sentence split across tweets.
   - **Draft file format:** one tweet, or thread tweets separated by lines containing only
     `---`. This is exactly what `scripts/typefully_post.py` parses.
   - **Write each tweet to fit 280 weighted characters** (URLs count 23, most emoji/CJK count
     2) — check as you go with `python3 scripts/x_len.py --file <draft> --thread`; don't write
     long and trim at the gate.
   - **No external links in tweet 1** — a needed link goes in the last reply tweet (see
     `voice/algorithm.md`).
   **Never fabricate or exaggerate** details that aren't true to the user's real experience —
   authenticity over drama (see voice-notes.md).
5. **Save the draft** to `drafts/` as `YYYY-MM-DD-slug.md` (ask the user for today's date if you
   don't have it; do not invent one).
6. **Research & fact-check — every external claim must be backed by ≥3 real, live sources (the post
   is *generated from* sources).** Do this after Save (you need the slug) and before showing the
   draft. List every **external/world claim** the draft makes — a vendor shipped X, a research
   finding, a statistic, a definition; anything about the outside world, not the user's own
   first-person experience. For each, **research it** (WebSearch / firecrawl / WebFetch) and
   **actually read the source to confirm it supports the claim** — a live URL is not enough, the
   content has to back the statement. Prefer **primary/authoritative** sources (official docs,
   release notes, the vendor's own announcement, standards bodies, reputable engineering writing);
   skip SEO/hype blogs. Radar-lane posts: reuse the digest's source URLs. Then write a sidecar
   `drafts/YYYY-MM-DD-slug.sources.json` pairing each claim to its URL(s) — **every claim needs ≥1
   source, and the post needs ≥3 distinct live source hosts overall** — and run
   `python3 scripts/verify_sources.py --file drafts/YYYY-MM-DD-slug.md` until it passes. The sources
   live **only** in the sidecar; **never put sources, links, or a "Sources" section in the post
   body** (links in tweet 1 also crush reach — see `voice/algorithm.md`; if the user wants the
   link public, it becomes the final reply tweet at publish time, called out in the preview).
   If a claim can't reach ≥3 reputable sources, **cut it or don't ship the post — never fabricate
   a citation or a fact.**
   - **Pure first-person posts** (no external claims — e.g. a personal story or hot take about
     the user's own work) make no outside-world assertion. Write a sidecar declaring
     `{"external_claims": false, "claims": []}`; the gate passes trivially. Be honest: if the
     post mixes a real external claim into a personal story, it is *not*
     `external_claims:false`.
   - **Narrate the gate — it's the slow step; never go silent through it.** Emit one short status
     line per claim as it resolves — `checking: "Sonnet 5 ships computer-use GA" → vendor
     announcement + docs ✓` — and one close line when the gate passes: `3 claims · 5 distinct
     hosts · gate passed`.
   - **The narration floor applies to every slow stretch, not just this one.** From the live run
     (3a) through the source gate, the render cycles, and publishing, **never go more than ~2 tool
     calls without a user-facing line.** Say what you're doing and what came back: `ran ruff
     0.15.5 vs 0.16.0 on local-fitness → 9 errors became 138`, `render 2 failed clip-overflow at
     688px, cutting a row`. Silence during a long stretch reads as a hang, and it hides the
     decisions the user would most want to interrupt.
   - **Re-verify on edit.** The show→edit→re-show loop below can add a claim after the sidecar was
     written. **Whenever an edit adds or changes an external claim, re-run this step** and update the
     sidecar before publishing.
7. **Pre-show self-check, then show the draft.** Before the user sees it, verify against
   `~/.claude/ghostwriter-x/voice/voice-notes.md`, hardest first:
   - **The ending** — the #1 AI tell. The post (or thread) stops on the last real point. No
     inverted-parallel closer, no clever-symmetry aphorism, no reflexive "what do you think?"
     CTA, no recap tweet that just restates the thread.
   - **Nothing fabricated** — no invented details, motivations, or timeline drama the user
     didn't actually live.
   - **Tweet 1 is the hook** — X has no fold: the first tweet must stand alone, carry the
     post's sharpest number or tension in its first line, and earn the tap into the rest. If
     the best number sits in tweet 3, move it up.
   - **Every tweet fits** — run `python3 scripts/x_len.py --file drafts/<slug>.md --thread` and
     fix any overflow now, not at publish.
   - **No banned tics** — em dashes, rule-of-three fragments, credential flexing, hedge words,
     "🧵👇", engagement bait.
   - **The save** — name (to yourself) the thing a reader keeps: a command, a checklist, a
     reusable model. A thread with nothing to keep is a lower-reach personal post on purpose —
     fine, but don't pad it with fake utility.
   Fix what fails, then **show the full draft in the X-true format** — numbered tweets, each in
   its own fenced block, each headed by its live weighted count in the form `[n/N · used/280]`
   (from `x_len.py`, not estimated):
   - A single post is `[1/1 · 243/280]` + the tweet.
   - One metadata line under the last block: `single|thread of N · save: <the thing a reader
     keeps> · lane: <lane>` (+ `link rides in final reply: <url>` when applicable).
   - **Re-shows lead with the delta:** after any edit, the first line is
     `Changed: <one-line summary>`, then the full draft in the same format — the user should never
     re-read the whole thread hunting for the edit.
   Then ask with a single `AskUserQuestion` **carrying TWO questions in the one call** — and wait
   for the answer:
   - **Q1 the text** — options **Publish** / **Edit** (the auto "Other" takes typed edit
     instructions directly) / **Scrap**.
   - **Q2 the visual** — the step-8 choice, asked here rather than in a second dialog, since the
     recommendation and its ASCII previews are already derivable from the approved text. If the
     user picks **Edit** or **Scrap**, the visual answer is simply discarded; that waste is
     cheaper than a guaranteed extra round trip on every post.
   - **Add Q3 only when step 3a produced first-person measurements** — the disclosure required by
     3b, as its own question ("these are real numbers, but I ran them this session, not you: keep
     the 'I ran…' framing, or switch to 'run this on your repo'?"). Never bury that in prose the
     user might skim past.

   The Publish tap immediately after seeing the exact full text is the explicit approval; an
   edited draft is re-shown and re-asked the same way. Do not publish unprompted.
   **Any voice/style feedback the user gives — append it to
   `~/.claude/ghostwriter-x/voice/voice-notes.md` in the same turn, BEFORE redrafting,** and say
   you did ("added to voice notes"). Fixing only the draft loses the correction and the user has
   to repeat it next session.
8. **The visual choice — asked in step 7's dialog, built only after the pick.** This is Q2 of the
   single approval call above, never a separate dialog: **text-only** / **single card** (name the
   Press hero component you'd compose around, e.g. "a duel" or "a ledger") / **image carousel** (a
   4-image post, or one image per tweet on a thread) — with your recommendation first, chosen from the
   post's shape and the outcome history: how-to or anything technical → a single 16:9 card
   carrying the steps the single tweet had to cut; personal story or hot take → text-only
   (X is text-native; a strong text post beats a weak image); carousels only on a
   user-requested thread. **Give every option an
   ASCII `preview` sketch of what THIS post would get:** the card option sketches the actual
   proposed Press composition as labeled blocks with this post's real headline; the carousel
   option sketches the image strip (`cover → point → point → recap`, using this post's real
   slide titles); text-only previews tweet 1 verbatim. Sketches are text in the question, not
   builds — authoring still waits for the pick. Only after the pick do you author and render
   (see **Visuals**); never render a form the user didn't choose. Cards are **composed, not
   templated**: read `assets/card-language.md`, check `images/card-history.jsonl`, and differ
   from the last 3 cards on ≥2 variation axes.
   **If the post is about the user's own agent, CLI, or code** — any visual that would show
   its output (a hero `term`, `code`, or `claude` card) — settle the output source in the
   SAME single question, via the option descriptions: you capture it live (run their CLI /
   call their MCP tool from this session), they paste or screenshot a real session, or —
   only if neither is possible — compose from facts already in the draft. One question
   total, never a second round-trip. See **Real-output cards** below.

### How-to posts (technical, from AI releases)

The priority lane, and the one radar items feed directly. When the anchor is a recent AI release,
write a genuine how-to — not a news recap.

- **Shape: a single tweet, with the steps on the card.** The tweet carries the implication
  (what the reader can now *do*) and the sharpest number; the concrete steps, real commands
  and the gotcha go into the composed Press card, which is where a how-to earns its
  bookmarks. Prescriptive, for the reader (voice-notes → Framing & audience). Only draft the
  step-per-tweet thread version when the user explicitly asks for a thread.
- **Real technical meat, accessible entry.** Use real commands, real config, real names — a
  curious non-expert can follow the tweet, an engineer still learns the mechanism from the
  card. This is what earns bookmarks and quote-posts.
- **Authenticity — how-to ≠ "I did this."** A release how-to makes external/world claims, so it
  is exactly the case the source gate is for: the `*.sources.json` sidecar + `verify_sources.py`
  step (step 6) is mandatory. **Never fabricate** or imply the user personally ran a release
  they haven't — write the steps generically, not as a first-person story.
- **Default visual: a composed Press card on tweet 1** — usually built around a **ledger**
  (numbered steps + the real command in a `.cmdbar`) or **tiles**. Compose it fresh per
  `assets/card-language.md` and vary against `images/card-history.jsonl`.

### Visuals (optional — diagrams & cards)

Only when the user opts in. Requires the diagram dependency (see README; if `render_image.py`
reports Playwright/Chromium is missing, point them at the install step and stop).

**Brand guide (per-user).** Styling + byline live in `~/.claude/ghostwriter-x/assets/diagram.css` —
the user's personal brand guide, shared across every install of the skill. On first use, if it
doesn't exist, copy it from the template: `mkdir -p ~/.claude/ghostwriter-x/assets && cp
assets/diagram.css.example ~/.claude/ghostwriter-x/assets/diagram.css`, then set their `--byline`,
their Press identity (`--press-sig` signature color + `--stamp` monogram initials), and tweak the
palette. Cards use `<div class="footer brand"></div>` to pull the byline automatically — don't
hardcode it. If the user already has a LinkedIn ghostwriter brand guide at
`~/.claude/ghostwriter/assets/diagram.css`, copy its personalization vars — same brand, new
geometry.

- **The Press system (THE brand — default for every card).** Editorial-poster identity: warm
  paper canvas, huge black type, serif standfirst, ONE loud signature accent, heavy ink rules,
  giant numerals, an issue-numbered masthead with the personal monogram stamp. Cards are
  **landscape 16:9 (1200×675)** — X's timeline crop — and **composed, not templated**: read
  `assets/card-language.md` (the component vocabulary, composition rules, and variation axes),
  pick the 1–2 body components that *prove the post's point* (a duel proves a decision, a
  ledger proves a method, a big stat proves a claim, a terminal proves it's real), and author
  a bespoke `images/<slug>.html`. `assets/card-template-press.html` is one example composition,
  not the shape. Landscape wants **hero-left / support-right** two-column arrangements, not
  stacked bands. **Anti-sameness contract:** before authoring, read
  `images/card-history.jsonl` and differ from the last 3 approved cards on **≥2 variation
  axes** (hero component, headline treatment, density, numeral presence, support texture);
  after the user approves the render, append the card's fingerprint line to that file.
- **Real-output cards (the fidelity contract).** Whenever a card shows the output of the
  user's own agent, tool, or code — a hero `term` component, a `code` card, a `claude`
  session card — the terminal content is a **transcription of a real session, not an
  invention**. A round of "make it look like my actual agent" is a defect: get the ground
  truth *before* authoring, not after the user complains.
  1. **Capture first.** In preference order: **run it yourself** (the user's CLI or MCP tool
     is often reachable from this session — call it and capture real output); else take the
     user's **paste or screenshot** (offered in the step-8 question). Save the raw capture —
     transcribing a screenshot faithfully if that's what you got — to
     `images/<slug>.source.txt` (gitignored, stays local), and iterate every render against
     that file, not against memory of it. **The card gets published: scrub secrets before
     transcribing** — tokens, keys, emails, home-directory paths, private hostnames get
     redacted or generalized in the card even though the capture keeps them.
  2. **Author as condensation, never invention.** Keep the session's anatomy — the prompt
     row, the tool-call indicator line, the real table with its actual metric names, values,
     baselines, and deltas, the verdict, the closing directive. Cut whole rows or sections to
     fit the budget; never smooth real output into summary prose, and never "clean up" the
     texture that makes it real.
  3. **Unknown value → `—` or one question.** Real CLIs print dashes for missing data; do the
     same. If one real number would complete the card, ask for that ONE number — never invent
     it.
  4. **Feed the post too.** Pull the capture's 1–2 strongest real numbers into the draft body
     (re-running the source gate if that adds an external claim).
  5. **Mirror check when a reference exists.** If the user supplied a screenshot or paste,
     then before EVERY showing: Read the reference and the render side by side and enumerate
     the structural mismatches yourself — missing prompt/tool-call lines, missing table
     columns or rows, invented phrasing, dead whitespace where the real session is dense. Fix
     and re-render until you find none; only then show the user.
- **The legacy light gallery (reference compositions).** The pre-Press light-system templates
  below remain shipped and renderable — use them as *structural references* when a Press
  composition wants a proven skeleton, or when the user explicitly asks for the light look.
  Two rules still apply when one is used:
    - **The topic graphic is the hero; any type-motif is a small accent.**
    - **Icons must fit the post.** The `<svg>` icons in every template are EXAMPLES, flagged with
      an `ICONS: …` comment. Pick topic-matching glyphs from `assets/card-icons.md` and swap them
      in for each card — **never ship a template's default icons or placeholder strings**; delete
      the `ICONS:` comment once swapped (the render lint fails the card otherwise).
- **Pick the form — Press composition first; the gallery table below maps legacy shapes.**

  | Post shape | Template | One-liner |
  |---|---|---|
  | **ANY (the default) — compose it** | **`press`** | brand system; pick hero: ledger / duel / pull / bigstat / tiles / term / bars |
  | How-to — 3–5 steps (legacy) | `howto` | numbered spine, icon + command chips |
  | How-to — 4 steps, compact | `howto-grid` | numbered tiles in a row |
  | How-to — 4–5 quick steps | `howto-check` | saveable green checklist |
  | How-to — 3–4 punchy steps | `howto-stack` | editorial big-number rows |
  | Teaching / how-it-works | `brief` | headline + before/after concept + thesis band |
  | Architecture / pipeline | `flow` | stage chips on a numbered spine |
  | Comparison | `matrix` | scorecard, winning cell per row |
  | Accelerating progression | `ramp` | rising bars to a payoff figure |
  | Launch / deprecation / event | `date` | ADMIT-ONE ticket, the date is the hero |
  | Education / outreach | `stem` | small toy-block STEM accent over a real graphic |
  | Code snippet | `code` | dark terminal, hand-highlighted |
  | Claude Code session | `claude` | transcript: request → actions → result |
  | Multi-image step-by-step | `carousel` | 4-image post or thread-with-images (see Carousels) |

  A **Mermaid diagram** (`--type mermaid`, a `.mmd`) also works for structured/technical
  content; a **designed card** (`--type card`, an `.html`) is the default for one punchy idea.
  All templates live in `assets/` (`card-template-press.html`, `card-template-howto.html`,
  `card-template-howto-grid.html`, `card-template-howto-check.html`,
  `card-template-howto-stack.html`, `card-template-brief.html`, `card-template-flow.html`,
  `card-template-matrix.html`, `card-template-ramp.html`, `card-template-date.html`,
  `card-template-stem.html`, `card-template-code.html`, `card-template-claude.html`,
  `card-template-carousel.html`, plus the generic `card-template.html` and
  `mermaid-template.html`). Card styling lives in `~/.claude/ghostwriter-x/assets/diagram.css`
  (the brand guide) — use its classes, don't add one-off inline CSS.
- **CONTENT BUDGET (hard limits).** Landscape 675px is short: fewer rows, wider lines than the
  LinkedIn sibling. The authoritative per-component numbers live in `assets/card-language.md`
  and in each template's header comment, and `scripts/card_lint.py` enforces the measurable
  ones (its `BUDGETS` dict is the single source of truth). Rules of thumb: 1–2 body components
  per card; ledger ≤3 rows; tiles exactly 4 in a row; terminal hero ≤12 rows × ≤64 chars;
  headline ≤2 lines. When the lint FAILs a budget, cut content — never shrink type below the
  template's floor.
- **Author the source** into `images/<slug>.mmd` or `images/<slug>.html`. Keep it to one idea;
  **never invent structure, numbers, or relationships that aren't true** (a misleading diagram
  is worse than none). **Card copy follows the voice rules too**: the voice-notes bans apply to
  every headline, lead, and caption, not just the post body.
- **Render:** `.venv/bin/python scripts/render_image.py --type <mermaid|card> --in images/<slug>.<ext> --out images/<slug>.png`
  — `--size 1200x675` is the default (a viewport hint; the screenshot crops to `#canvas`, and
  Mermaid auto-fits), so cards need no size flag. Pass `--strict` on the pre-publish render so
  any lint FAIL exits non-zero. **Never pass `--no-open` in an interactive Generate session** —
  the command auto-opens the PNG in the user's own image viewer by default, and that auto-open
  (not a chat-embedded copy) is how the user actually sees it full-size on their own screen.
  `--no-open` is for headless/batch/CI use only; if a render command ever produced a PNG
  without opening it, run `open images/<slug>.png` (macOS) immediately after.
- **Lint before you look — it is far cheaper than an image Read.** Run
  `.venv/bin/python scripts/card_lint.py --in images/<slug>.html` and clear every FAIL *first*.
  The lint already catches the things that used to burn a render cycle each: `clip-overflow`
  (content taller than the frame), `term-not-in-capture` (a terminal row that isn't in
  `<slug>.source.txt` — i.e. invented or quietly edited output), `term-underfilled` / `panel-rag`
  (a wide panel floated over short lines), `term-misaligned`, and the count budgets. Fixing those
  on the source costs one edit; finding them in the PNG costs a render plus a Read.
- **MANDATORY: after the lint is clean, Read the PNG yourself and judge it like an art director
  BEFORE showing the user** — check what the lint cannot: does the composition actually prove the
  post's point, is the hierarchy right, is there one dominant accent, are there widow words, does
  the hero earn its space. Fix and re-render until you'd publish it; the user sees only cards that
  already pass. Treat every FAIL as a defect, not a suggestion.
- **Show the user the rendered PNG** and iterate (tweak the source or
  `~/.claude/ghostwriter-x/assets/diagram.css`) until they approve it. Don't claim it looks good
  without showing the image. **On approval, append the card's fingerprint to
  `images/card-history.jsonl`** (see `assets/card-language.md`).
- **Write alt text** describing the visual; you'll pass it to the publish step. Every image
  gets alt text — X supports it and the publish script sends it.

#### Carousels (multi-image posts — X has no PDF documents)

An X "carousel" is either a **4-image post** (X shows up to 4 images in a grid — order them
cover → point → point → recap) or a **thread with one image per tweet** (each tweet's image
illustrates that tweet's beat; better for 5+ beats). Slides are 16:9 (1200×675) PNGs. Workflow:

1. **Author** `images/<slug>-carousel.html` from `assets/card-template-carousel.html`: one
   `.slide` per image, `press` class on every slide so the deck wears the brand. One idea per
   slide, ≤~30 words/slide. **4-image post → exactly 4 slides**; thread-with-images → one
   slide per tweet, matching the thread's beats. Same authenticity rule: never invent numbers
   or structure.
2. **Render:** `.venv/bin/python scripts/render_carousel.py --in images/<slug>-carousel.html`
   — writes `images/<slug>-NN.png` per slide (it refuses >4 slides unless `--allow-many`, which
   is the thread-with-images case) and prints the exact `typefully_post.py --image` flags to publish
   with.
3. **Show the slides** and iterate until approved (don't claim they look good without showing
   them).
4. **Publish** with the printed `--image N:path --alt N:text` flags (see Publish mode). The
   post body is still the draft text; images ride on the tweets.

### Engagement craft (apply to every draft)

The full rationale is in `voice/algorithm.md` — read it. The essentials:

- **Tweet 1 is the whole ballgame.** No fold, no "…see more": the first line stops the scroll
  or nothing else matters. Sharpest number, claim, or tension first. No throat-clearing, no
  "a thread on…" preamble.
- **One idea per post.** Cut anything that isn't serving the single point.
- **Optimize for replies and bookmarks, not applause.** Real conversation and reference-worthy
  content drive distribution. Never engagement-bait.
- **Teach something.** A command, a config, a mental model — the thing a reader keeps is what
  gets bookmarked and quoted.
- **Specifics over abstractions.** Real numbers, real moments, real names of things.
- **One tweet is the default.** Cut to the sharpest beat and let the card carry the rest;
  only thread when the user asks. In a requested thread, each tweet is a complete thought
  that stands on its own, never a sentence split across tweets, numbered (`3/7`) when it
  aids navigation.
- **280 weighted chars per tweet** (URLs 23, emoji/CJK 2) — write to fit; `x_len.py` is the
  referee, not the editor.
- **No external links in tweet 1** (they suppress reach); a needed link is the final reply.
- **Earn the ending on substance.** The post stops on the last real point — no recap tweet,
  no reflexive closing question.
- **Sound human.** No "game-changer", no "delve", no "🧵👇", no manufactured humility. If it
  reads like AI, rewrite it. Match the profile's "Never do" list.
- **Hashtags: default none** (0–2 absolute max, only if the voice profile uses them).

---

## Mode: Publish

Only after the user explicitly approves a specific draft.

1. **Preview the payload** (optional sanity check):
   `python3 scripts/typefully_post.py --file drafts/<file>.md --dry-run`
   — shows the exact Typefully draft payload (the thread as a posts array) plus every
   tweet's weighted count.
2. **Publish:** `python3 scripts/typefully_post.py --file drafts/<file>.md --lane <lane>`
   — pass the post's content lane (`release-howto` / `personal-project` / `opinion` / `career` /
   `personal`) so the publish log (`~/.claude/ghostwriter-x/published.jsonl`, written
   automatically on success) can feed the outcome loop. Omitting `--lane` still publishes.
   - **Source gate runs automatically.** A real (non-dry-run) `--file` publish is refused unless the
     draft's `*.sources.json` sidecar passes `verify_sources.py` (≥3 distinct live hosts, every claim
     sourced, or `external_claims:false`). If it fails, **fix the sidecar / redo the research step,
     not the gate** — re-run Generate step 6, then retry. A bare `--text`/stdin publish is refused by
     design (nothing to verify). Do **not** reach for `--allow-unverified` to get past a failure —
     that flag is human-only.
   - **With approved images**, add `--image [tweetN:]images/<slug>.png --alt "[tweetN:]<alt text>"`
     per image (max 4 per tweet; `render_carousel.py` prints the exact flags for carousels).
     Alt text is recorded locally; remind the user to set it on the live post (X → post →
     edit alt) since Typefully's draft API attaches media by id.
   - **`--draft-only` is the fallback, not a shortcut.** It creates the draft in Typefully without
     publishing and prints its URL, for when X policy blocks direct publishing (see Report,
     below). It still runs the source gate. A parked draft is deliberately **not** written to
     `published.jsonl` — that log records what actually went live, and polluting it with drafts
     would corrupt the outcome loop. Use it only after a real block or when the user asks; the
     default path is a real publish.
   - **Link in final reply:** if the approved draft calls for a public link, it is the last
     tweet of the thread (already in the draft file) — never inserted at publish time into a
     text the user didn't see.
   - Never attach a visual the user hasn't seen and approved; if it changes, re-show and re-confirm.
3. **Report** the result. On success, share the post URL the script prints (Typefully
   publishes asynchronously; the script polls until the post is live).

   **When it fails, run a recovery, not a debugging session.** A failed publish is the moment the
   user most needs to hear from you, and on a real run they instead watched eight silent tool
   calls of API spelunking. **The first thing you say after any publish failure is whether
   anything went out** — that is the only question they actually have. Then classify, in one
   short line each, and offer the next step as a choice rather than disappearing into diagnosis:
   - **401** — the API key is wrong; fix `TYPEFULLY_API_KEY`. Nothing posted.
   - **402** — the account is paused or over the free plan's ~15 posts/month. Say so plainly
     rather than retrying. Nothing posted.
   - **403 "Direct publishing of X drafts containing URLs is blocked"** — X policy, tripped by
     text that *looks* like a hostname; dotted config keys are the usual culprit (`lint.select`,
     `[tool.ruff.lint]`) while a bare filename like `ruff.toml` is fine. **The draft was never
     created, so nothing posted and a retry is safe.** Offer both fixes: reword the token, or
     re-run with `--draft-only` to park the exact approved text in Typefully for the user to
     publish from the UI.
   - **Media upload failure** — nothing posted; media uploads run before the draft is created.
   - **Timeout while polling** — the one genuinely ambiguous case: the draft may still go out.
     **Check the printed Typefully link before re-running**; a blind retry risks a double post.

   Debug only what the error doesn't already explain, and **read the script before writing any
   probe against it** — a debug script written from memory of the API guessed the wrong base URL
   and auth header and cost two wasted round trips.
4. **Prompt the reply window.** Reach is largely decided in the first 30–60 minutes (see
   `voice/algorithm.md`). After sharing the URL, remind the user to, in the next hour: reply
   to every substantive response with substance (a question back, not just "thanks"), and go
   engage in a couple of adjacent conversations. The script can't do these; they are the
   single biggest fix for low reach.
5. **Say when you'll ask how it did, and mention the quota if it's tight.** One line, right after
   the URL: *"I'll ask how this did in a couple of days."* The check-in otherwise only exists at
   the top of Generate, which is reachable only when the user is about to publish *again* — so
   without this the loop is invisible until it fires. Tell them they can also just ask **"how did
   my posts do?"** any time, which runs the check-in on its own. If
   `python3 scripts/typefully_post.py --quota` shows **2 or fewer posts left**, say so here too,
   with the reset date — the free plan's cap is otherwise discovered by eating a 402 on a post
   they already approved.

Never run the non-`--dry-run` publish command without a clear, specific approval from the user
for that exact draft.

---

## Guardrails

- **Never publish without explicit approval** of the specific text — every tweet of a thread,
  shown with its real weighted count. Editing the draft → re-show → re-confirm.
- **Never print or commit secrets.** `.env`, `data/`, and `drafts/` are gitignored; keep it that
  way. Don't echo the Typefully API key in chat.
- **Don't fabricate facts** in posts — no invented metrics, quotes, or events. **Every
  external/world claim must clear the source contract** (Generate step 6): ≥3 distinct live,
  reputable sources recorded in the draft's `*.sources.json` sidecar and confirmed to *support* the
  claim, enforced at publish by `verify_sources.py`. Sources stay in the sidecar, **never in the
  post body**. If you can't source a claim, cut it — don't ship it.
- **`--allow-unverified` is human-only.** It is the single bypass of the source gate and exists for a
  human to override a genuine edge case (e.g. a real source transiently down). **The agent must
  never set it to get past a failed gate** — fix the sidecar / redo the research instead.
- **One post per request** unless the user asks for several.
- **No unattended posting — ever.** X's API permits posting on the user's own behalf, but this
  skill's hard rule is that every post is member-initiated and explicitly approved, one at a
  time — **never add fully autonomous / scheduled posting** (X's platform-manipulation and spam
  rules prohibit bulk/duplicative automation, and an unreviewed AI post on a real account is a
  reputational hazard regardless). Do NOT set up scheduled, looped, cron, or unattended posting;
  do NOT scrape x.com for voice data, topics, or analytics (use the archive export and the
  official API only). See `COMPLIANCE.md`. If the user asks for autonomous auto-posting,
  decline and explain this.
