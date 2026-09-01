---
name: ghostwriter
version: 0.18.0
user_invocable: true
description: Write engaging LinkedIn posts in the user's own voice and publish them to their profile after they approve. Use when the user wants to draft, write, or post something to LinkedIn, asks for a "LinkedIn post", wants content about trending topics in their field, or wants to set up / configure LinkedIn auto-posting. Learns the user's voice from their past posts and never publishes without explicit approval.
---

# LinkedIn Ghostwriter

Draft LinkedIn posts that sound like the user, then publish to their own profile via
LinkedIn's official API — **only after they approve the draft**. Never auto-publish.

The repo root is the directory containing this skill's `scripts/`, `voice/`, and `drafts/`
folders. All commands below are run from that repo root.

**Personal data lives in `~/.claude/ghostwriter/`, not the repo.** The voice profile
(`voice/voice-profile.md`, `voice-notes.md`, `interests.md`), the brand guide
(`assets/diagram.css`), and LinkedIn credentials (`.env`) are read from
`~/.claude/ghostwriter/{voice,assets,.env}` — the same location whether the skill is running
from this repo, an installed Claude Code plugin, or Claude Desktop, so editing your voice or
brand once is visible everywhere. `voice/algorithm.md` (LinkedIn reach tuning) stays bundled in
the repo — it's shipped, identical content, not personal. `data/`, `drafts/`, `images/`,
`scripts/` also stay repo-local since they're tied to running the actual publish flow from one
place.

## Decide which mode you're in

- **Setup** — `~/.claude/ghostwriter/.env` has no `LINKEDIN_ACCESS_TOKEN`, or
  `~/.claude/ghostwriter/voice/voice-profile.md` is missing, or the user says "set up",
  "configure", "connect my LinkedIn". → Run **Setup**.
- **Generate** — the user wants a post (the common case). → Run **Generate**.
- **Publish** — the user approves a draft you already showed. → Run **Publish**.

Before generating, quietly confirm setup is done: `~/.claude/ghostwriter/voice/voice-profile.md`
exists and `~/.claude/ghostwriter/.env` contains `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PERSON_URN`.
If not, switch to Setup.

**Keep this invisible, and never narrate commands.** The user should not see bash command
lines in chat at any point in the run; they see one status line per step or gate. Nate,
2026-08-28: "no need for the skill to print and show all the bash commands, it makes it very
messy." Do the setup check (and any other bookkeeping — idea-board/radar
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

1. **LinkedIn app.** Ask them to create an app at <https://www.linkedin.com/developers/apps>,
   add the **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** products,
   and under **Auth** add the redirect URL `http://localhost:8765/callback`. They give you the
   **Client ID** and **Client Secret**.
2. **.env.** Run `mkdir -p ~/.claude/ghostwriter && cp .env.example ~/.claude/ghostwriter/.env`,
   then write their Client ID/Secret into `~/.claude/ghostwriter/.env` (edit the file; never echo
   the secret back in chat).
3. **Authorize.** Tell them to run `python3 scripts/linkedin_auth.py` themselves (it opens a
   browser for them to click "Allow"). It writes the token + person URN into
   `~/.claude/ghostwriter/.env`.
4. **Export posts.** Tell them to request their data from LinkedIn (Settings → Data privacy →
   *Get a copy of your data* → **Posts**), and drop the resulting `Shares.csv` into `data/`.
   The email takes ~10 minutes.
5. **Extract.** Once `data/Shares.csv` exists, run `python3 scripts/extract_posts.py`.
6. **Build the voice profile.** Do the **Voice Profile** step below.
7. **Interests & voice notes.** If they don't exist yet (e.g. a fresh clone), seed them from
   the templates: `mkdir -p ~/.claude/ghostwriter/voice && cp voice/interests.example.md
   ~/.claude/ghostwriter/voice/interests.md` and `cp voice/voice-notes.example.md
   ~/.claude/ghostwriter/voice/voice-notes.md`. Then help them fill in
   `~/.claude/ghostwriter/voice/interests.md` (interview them if it's empty). `voice-notes.md`
   ships with sensible defaults; append the user's own feedback to it as it comes up.

If the user has no usable export (few/no past posts), skip 4–5 and build `voice-profile.md`
by interviewing them: ask about tone, the 3–5 topics they're known for, formatting habits
(emoji? hashtags? short lines?), and what they never want to sound like.

### Voice Profile (the heart of "sounds like me")

Read `data/my_posts.md` in full, then write `~/.claude/ghostwriter/voice/voice-profile.md`
(`mkdir -p ~/.claude/ghostwriter/voice` first if it doesn't exist yet) capturing:

- **Voice & tone** — e.g. direct, contrarian, warm, wry. Quote 2–3 lines that exemplify it.
- **Sentence rhythm** — short and punchy? long and layered? fragments for emphasis?
- **Openers** — how do their best posts hook in the first line? (question, bold claim, story,
  stat). List the patterns they actually use.
- **Closers / CTAs** — do they end with a question, a one-liner, a call to engage, nothing?
- **Structure** — line breaks between every sentence? lists? the "1 idea per line" style?
- **Vocabulary & tics** — recurring phrases, signature words, how they swear or don't.
- **Emoji & hashtags** — none / sparing / heavy; which ones; where.
- **Topics they own** — the themes they return to.
- **Never do** — anti-patterns to avoid (corporate buzzwords, em-dash overuse, "I'm humbled to
  announce", fake vulnerability, generic AI-slop phrasing). Be specific to *this* person.

Keep it concrete and example-driven — it's a generation guide, not an essay.

---

## Mode: Generate

**Posture: propose, don't interrogate.** The default is *you* surface concrete, already-real
ideas and the user taps one — not a blank "what do you want to post about?" The picked idea is the
post's real anchor, so there's no generic interview.

**Outcome check-in (max one dialog, fast — the feedback loop).** Before anything else, run
`python3 scripts/post_outcome.py --list-unscored` (reads `~/.claude/ghostwriter/published.jsonl`,
written automatically on every publish). If any post **≥2 days old has no `outcome`**, ask ONE
check-in covering the **most recent unscored post** (up to 3 if several are recent) — *"How did
'<first_line>' do?"* with options great / normal / flopped — **and ask for the impressions
number** (read off the post's analytics in the LinkedIn app; it takes seconds and it is the only
real distribution signal we get). The label alone is still accepted if they don't have the
number. Record each:
`python3 scripts/post_outcome.py --slug <slug> --outcome <answer> --impressions <n> --notes "<notes>"`.
If there's a **backlog** of older unscored posts, offer once to skip it (`--outcome skipped` is
not a thing — just leave them; don't re-ask every session). **One dialog to
start: if the idea menu (step 2) is also due, the check-in and the menu ride in the SAME single
`AskUserQuestion` call** — the check-in takes the first question slot and the flat idea question
(step 2) takes the second — still one dialog, one round trip, never two sequential question
dialogs to get a session moving. Only when no menu is due (the topic came in concrete)
may the check-in be its own question. Never ask more
than once per session; nothing to score → skip silently, don't mention it. **Use the accumulated
outcomes everywhere you choose:** lean the idea menu toward lanes that scored `great` and away
from repeated `flopped`, let format outcomes steer the visual-form recommendation (step 8), and
watch the **impressions trend** — while it sits under ~300, the recovery protocol in
`voice/algorithm.md` governs cadence, format, and timing. This is the only compliant
performance signal we have (no scraping — COMPLIANCE.md), so actually use it.

1. **Short-circuit if the topic is already concrete.** If the user named a specific topic, pointed
   you at a source, or said "draft a post from item N in the radar," skip the menu and go straight
   to grounding + drafting (step 3). The menu below is the default only for an open-ended "write me
   a post."
2. **No topic given → ONE flat idea question, pick and go.** Gather concrete, ready-to-write
   ideas from the four lanes below *yourself*, then **flatten them into a single ranked list**
   (lane priority order below, bent by outcome history) and present the **top 3** as **ONE
   single-select `AskUserQuestion`** — options are the 3 ideas plus a 4th, **"Show more
   ideas."** Never go back to asking one question per lane: that forced paging past unrelated
   cards even after the user had already picked, which is exactly backwards. Rules of the
   question:
   - **Every idea option carries a `preview`** (≤ ~9 lines so the pane never clips): the working
     hook (the post's first ~2 lines as they'd actually read), the suggested angle in one
     sentence, and a source-freshness line prefixed with its lane (e.g. `Trending · HN 612 pts /
     340 comments · Jul 18`, `Radar · Jul 17 · anthropic.com`). A user should be able to pick on
     the preview alone.
   - **Picking a real idea goes straight to grounding + draft (step 3) — nothing else to answer
     or dismiss.** The auto "Other" on the question takes a typed topic directly (same
     short-circuit as step 1).
   - **Picking "Show more ideas" asks exactly ONE follow-up single-select question** with the
     next batch (the remaining candidates, up to 3 + auto "Other"), same preview format. This is
     the only path that costs a second round trip, and only because the user explicitly asked.
   - **One provenance line total in chat**, not per lane (radar date + job health, live-search
     date, repo names) — don't dump a duplicate board into chat; the question options carry the
     ideas.
   - **When the outcome check-in is due** it rides as the first question in the SAME call (see
     above); the flat idea question is the second. Still one dialog, one round trip.

   The four lanes, in priority order (used to rank the flattened list, not to structure separate
   questions). **This order is outcome-driven, not editorial:** first-person build stories are
   the only lane that has ever rated `great`, and both `flopped` posts were news-shaped
   (release/opinion takes on someone else's announcement). News still surfaces — but only when
   the signal is strong AND the user has a real angle, and it ranks below lived work:
   - **Your recent Claude projects (2–3 entries — the lead lane).** Run
     `python3 scripts/recent_projects.py` and
     take the top 2–3 repos with recent Claude Code sessions; for each, read the recent `git log`
     + last session summary for the **one real thing shipped** (that's the anchor). Respect
     `~/.claude/ghostwriter/voice/interests.md` → **Off-limits**: never surface or post anything
     work-confidential (e.g. GoodLeap internals); personal/OSS repos only.
   - **Interests, personal stories & hot takes (1–3 entries).** Read
     `~/.claude/ghostwriter/voice/interests.md` —
     core themes, the "Strong opinions" list, and the story bank — for specific angles not
     covered recently (check `published.jsonl` and recent drafts). A strong uncovered story-bank
     item beats a generic theme; label each `interests · <theme or story>`. The personal/life
     lane rides here (voice-notes → Topic lean: ~1 post in 4).
   - **Trending now (live, run-day — VERIFIED trending, not vibes).** "Trending" means you can
     point at the surge, not that a web search returned articles; vendor blogs and SEO listicles
     are not trending signals. Check measurable surfaces directly, TODAY: **Hacker News via the
     Algolia API** (top stories from the last ~3 days, e.g.
     `curl 'https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points>150,created_at_i>'"$(date -v-3d +%s)"`),
     **top posts this week** in the relevant subreddits, and **news coverage from the last
     ~48 h** (search with explicit recency). Filter through the trending areas in
     `~/.claude/ghostwriter/voice/interests.md`, propose **2–3 topics**, each with the specific
     angle the user could own (a trending topic without their angle is just news), and put the
     ACTUAL signal in the preview's source line — points, comments, story volume, date
     (`trending · HN 612 pts / 340 comments · Jul 18`). No citable signal → the item doesn't go
     in the lane; fewer real trending items beat padded ones.
   - **Release radar — current through TODAY, not through the last digest.** Read the newest
     `research/release-radar-*.md` and the tail of `research/.radar.log`, and state provenance in
     the board ("Jul 17 radar, job ran clean"). **If the digest is older than today, top the lane
     up**: one quick live search for AI releases since the digest date, so the lane is current
     through the day the user actually runs ghostwriter — label digest items `radar · <date>` and
     top-ups `live · today`. Reuse digest items' title + "suggested angle" (already how-to-shaped
     and source-backed; the twice-weekly `scripts/release_radar.sh` job scans the broader AI
     industry, not just Anthropic). Never add experience claims the digest didn't establish; the
     digest's **Discussion radar** items feed opinion/hot-take slots the same way. Skip items
     already published (check `published.jsonl`). **Radar stale (>4 days) or missing** → say so,
     note whether the log shows the job failing, and run the lane fully live; if the job is broken
     (e.g. exit 127 — usually the repo moved), offer to repair it: `bash scripts/install_radar.sh`
     re-renders the launchd agent against the repo's current path.
   **Build the list fast and honestly.** Gather all four lanes in parallel (the HN check, the
   radar read + top-up, interests, `recent_projects.py`) so the question is the first thing the
   user waits on. An idea appears in exactly ONE lane — a personal build story about a release
   the user actually ran stays in the projects lane (lived beats trending); a release surging on
   HN that the user hasn't touched is Trending, not Radar. Filter every candidate against
   `published.jsonl`
   and recent `drafts/` so nothing already covered resurfaces. Rank the flattened list by lane
   priority and the outcome history, and say so in the provenance line when it bends the order
   ("build stories lead; your last news post flopped").

   **Persist the full list — research the user paid for doesn't evaporate.** Whether or not it
   was shown, write `research/idea-board-YYYY-MM-DD.md`: every idea gathered (not just the 3
   surfaced) with its lane, signal, angle, and status (`picked` / `on deck`). On the next
   open-ended run, read the newest board (≤7 days old) and fold still-good unpicked ideas back
   into the flattened ranking labeled `on deck · <date>` — re-verify a trending idea's signal
   before reusing it, and drop anything that went stale.

   **After the pick: lock it in, zero extra dialogs.** Echo a compact brief and go —
   `Locked in: <idea> · <lane>`, then one line each for the angle, the real anchor, the save
   (the thing a reader keeps), and the sources you'll verify against. Then straight to
   grounding + draft (step 3); no second drill. A release-how-to pick follows the **How-to
   posts** playbook below; a topic typed via "Other" is the short-circuit path (step 1).
3. **Confirm the anchor, then draft.** Every post still needs **one concrete, real, first-person
   anchor** — the actual tool, a real number, a specific decision, a thing that actually happened
   (see voice-notes.md → Substance bar + Authenticity). The menu pick normally *is* that anchor.
   Only the personal-project lane sometimes needs a single sharp follow-up to nail the specific
   detail — ask **one** `AskUserQuestion`, never the old generic 2–3-question interview. **Never
   fabricate a detail to clear this bar.** If there's genuinely no real anchor, say so rather than
   shipping a generic post.
4. **Draft against the voice profile.** Read `~/.claude/ghostwriter/voice/voice-notes.md`,
   `~/.claude/ghostwriter/voice/voice-profile.md`, AND `voice/algorithm.md` (bundled, repo-relative)
   first, every time (voice-notes.md holds direct user feedback and takes priority; algorithm.md is
   reach optimization and must never override voice). If a voice file is missing — e.g. a fresh
   setup — copy `voice/voice-notes.example.md` to `~/.claude/ghostwriter/voice/voice-notes.md` and
   proceed with what you have (`~/.claude/ghostwriter/voice/interests.md` plus the defaults). Write the
   post to match them — their openers, rhythm, formatting, emoji/hashtag habits. Apply the
   **Engagement craft** rules below AND the reach rules in `voice/algorithm.md` (hook in the
   first ~210 chars, default 50–120 words, optimize for *saves*, no links in the body). Aim for one
   strong post, not three mediocre options.
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
   body** (in-body links also crush reach — see `voice/algorithm.md`). If a claim can't reach ≥3
   reputable sources, **cut it or don't ship the post — never fabricate a citation or a fact.**
   - **Pure first-person posts** (no external claims — e.g. a personal/vulnerable story) make no
     outside-world assertion. Write a sidecar declaring `{"external_claims": false, "claims": []}`;
     the gate passes trivially. The authenticity/substance bar in
     `~/.claude/ghostwriter/voice/voice-notes.md` covers these. Be honest: if the post mixes a
     real external claim into a personal story, it is *not*
     `external_claims:false`.
   - **Narrate the gate — it's the slow step; never go silent through it.** Emit one short status
     line per claim as it resolves — `checking: "Sonnet 5 ships computer-use GA" → vendor
     announcement + docs ✓` — and one close line when the gate passes: `3 claims · 5 distinct
     hosts · gate passed`. One line each, no tables; the user should see the research happening,
     not a minute of dead air followed by a draft.
   - **Re-verify on edit.** The show→edit→re-show loop below can add a claim after the sidecar was
     written. **Whenever an edit adds or changes an external claim, re-run this step** and update the
     sidecar before publishing. (The AI-fingerprint gate in step 7 re-runs on every edit too.)
7. **The AI-fingerprint gate, then the pre-show self-check, then show the draft.**
   - **Run the gate first, every time, before the user sees a word:**
     `python3 scripts/ai_tells.py --file drafts/YYYY-MM-DD-slug.md --judge`. It is the deterministic
     encoding of the bans in `~/.claude/ghostwriter/voice/voice-notes.md` (em dashes, the "No X. No
     Y. No Z." list, the reflexive closing question, an antithesis closer, the strawman opener,
     "here's the thing", slop words, credential flexing, emoji bullets, hashtag piles, 60-word
     paragraphs) plus a cost-capped LLM judge (`claude -p`, Haiku, ≤$0.10 a call) that scores
     AI-likeness 0–10 against the real voice files and quotes the phrases it read as AI. **Any
     `FAIL`, or a judge score under 7, means rewrite and re-run** until the close line reads
     `ai-tells: clean · judge N/10`; a `WARN` is a smell to weigh, not a block. Narrate it like the
     source gate: one line per finding as you fix it, then the close line, which also goes under
     the draft's metadata line when you show it. **Re-run the gate after every edit** in the
     show→edit→re-show loop; an edit is how a tell gets back in. Passing the gate is the floor:
     the checks below are the judgment layer on top of it, not a substitute for it.
   Then verify against `~/.claude/ghostwriter/voice/voice-notes.md`, hardest first:
   - **The ending** — the #1 AI tell, flagged more than anything else. The post stops on the
     last real point, or on a genuine question the user actually wants answered. No
     inverted-parallel closer, no clever-symmetry aphorism, no reflexive
     "what's your…?" CTA.
   - **The register — warm, personable, human (voice-notes → Register).** This is a positive
     check, not a ban: the post opens on the situation or the human reason (not a statistic),
     names the real thing in plain words instead of a category, narrates first-person as
     something that happened to the user, and reads like them talking to a peer. A draft that
     merely avoids every banned tic but sounds like an incident report FAILS this check —
     rewrite the clinical sentences in the words the user would say out loud.
   - **The feed-native check — would this sit naturally in the user's own feed?** Read 2–3 of
     their real posts from `data/my_posts.md` next to the draft. Their real register is the
     bar: one idea per line or a 1–2 sentence paragraph, blank line between, **no paragraph
     over ~40 words**, questions and casual energy where they'd really use them. A draft that
     reads like a polished essay next to their real posts FAILS this check even if it breaks
     no ban — the essay register is itself the AI tell (voice-notes → Recalibration
     2026-08-19). Reformat and rewrite until it belongs in that feed.
   - **Nothing fabricated** — no invented details, motivations, or timeline drama the user
     didn't actually live.
   - **Length and shape** — default 50–120 words (see Engagement craft), and **varied against
     the last few posts**: if the recent posts all ran the same length and arc, this one
     shouldn't (uniformity across a feed reads as automation).
   - **No banned tics** — em dashes, rule-of-three fragments, credential flexing, hedge words.
   - **The hook** — the post's single most specific number or sharpest tension appears in the
     first ~210 chars (before "…see more"). If the best number sits below the fold, move it up.
   - **The save** — name (to yourself) the thing a reader keeps: a command, a checklist, a
     reusable model. If there's nothing to keep, either rework toward reference-worthy or
     accept it's a lower-reach personal post on purpose — don't pad it with fake utility.
   Fix what fails, then **show the full draft in the LinkedIn-true format**:
   - The draft text in a fenced block, with a visible fold line —
     `┄┄┄ …see more (fold ~210 chars) ┄┄┄` — inserted at the line break nearest char 210, so the
     user sees exactly what shows above the fold. (A draft that ends before the fold needs no
     marker.)
   - One metadata line under the block: `N words · save: <the thing a reader keeps> · lane: <lane>`,
     and the gate's close line under that: `ai-tells: clean · judge 8.4/10`.
   - **Re-shows lead with the delta:** after any edit, the first line is
     `Changed: <one-line summary>`, then the full draft in the same format — the user should never
     re-read the whole post hunting for the edit.
   **Chat text is NOT a reliable approval view.** The Claude Code client collapses the
   assistant message immediately preceding a tool call to "(summarized)", so a post printed in
   chat right before the dialog is routinely never seen (real session, 2026-08-28: "it says it
   is printed but it is not", with a screenshot showing the collapsed message). Immediately
   before EVERY approval dialog, **open the draft file on the user's own screen**:
   `open drafts/YYYY-MM-DD-slug.md` (macOS; `xdg-open` on Linux) so the complete text is in a
   window the dialog cannot hide, and say so in the question ("the draft is open in your
   editor"). The preview-pane / plain-print rules below are additive, not a substitute. Then
   ask with a single `AskUserQuestion` — options **Publish** / **Edit** (the auto "Other"
   takes typed edit instructions directly) / **Scrap** — and wait for the answer. **The user
   must be able to read every line of the final post at the moment of decision — both real
   failure modes are known, pick the mechanism by line count:**
   - **Post fits the preview pane unclipped (≤ ~9 lines): the complete, final post text goes
     in the approval dialog** (verbatim, no fold marker, no metadata line) as the `preview` of
     the Publish option. A real session (2026-08-11) reached the approval question twice
     without the user ever having seen the whole post because it lived only in scrollback —
     the dialog takes focus over chat.
   - **Post longer than ~9 lines — which feed-native posts usually are: the preview WILL clip
     (a real session, 2026-08-19, hid 11 of 13 lines this way).** Print the complete post
     plainly in the chat message immediately before the dialog (no fold marker, no fence), and
     make the question itself name the line count and the final line ("the full post is
     printed above — 13 lines, ends with …") so the user can verify they saw all of it before
     answering. Never put text the pane will clip in the preview and call it shown.
   The Publish tap on a dialog whose text the user has verifiably seen in full is the explicit
   approval; an edited draft is re-shown and re-asked the same way. Do not publish unprompted.
   **Any voice/style feedback the user gives — append it to
   `~/.claude/ghostwriter/voice/voice-notes.md` in the same turn, BEFORE redrafting,** and say
   you did ("added to voice notes"). Fixing only the draft loses the correction and the user has
   to repeat it next session.
8. **Settle the visual with ONE question — build nothing first.** After the text is approved,
   ask a single `AskUserQuestion`: **text-only** / **native screenshot** (a real terminal, chart,
   or photo the user already has or you can capture live) / **single card** (name the Press hero
   component you'd compose around) / **carousel** — with your recommendation first, chosen from
   the post's shape and the outcome history: **text-only or a native screenshot is the default
   recommendation** (dwell comes from information, and a real artifact reads as a human, not a
   content pipeline — see `voice/algorithm.md`); a genuine multi-step how-to → **carousel**; a
   composed Press card **only when the composition itself carries real information** (a real
   diagram, real output), never as decoration. **Card fatigue check: read the `format` field of
   the last 3 records in `published.jsonl` — if 2+ of them shipped an image, do not recommend a
   card, and say why.** The identical Press branding on every post is feed-level repetition (the
   "automation posting at scale" pattern LinkedIn explicitly targets); while the recovery
   protocol is in force, cap cards at ~1 in 4 posts — brand consistency is deliberately traded
   down for reach recovery. **Give every option an ASCII
   `preview` sketch of what THIS post would get:** the card option sketches the actual proposed
   Press composition as labeled blocks (masthead / hero / colophon, with this post's real
   headline and hero named, e.g. `[ DUEL: cron vs launchd ]`); the carousel option sketches the
   slide strip (`cover → 5 steps → recap → CTA`, using this post's slide titles); the native
   screenshot option names the specific real artifact it would show (which terminal output,
   which chart); text-only
   previews the draft's first ~2 lines above the fold marker. Sketches are text in the question,
   not builds — authoring still waits for the pick. Only after
   the pick do you author and render (see **Visuals**); never render a form the user didn't
   choose. Cards are **composed, not templated**: read `assets/card-language.md`, check
   `images/card-history.jsonl`, and differ from the last 3 cards on ≥2 variation axes.
   **If the post is about the user's own agent, CLI, or code** — any visual that would show
   its output (a hero `term`, `code`, or `claude` card) — settle the output source in the
   SAME single question, via the option descriptions: you capture it live (run their CLI /
   call their MCP tool from this session), they paste or screenshot a real session, or —
   only if neither is possible — compose from facts already in the draft. One question
   total, never a second round-trip. See **Real-output cards** below for what to do with
   the capture.

### How-to posts (technical, from AI releases)

The lane radar items feed directly. When the anchor is a recent AI release,
write a genuine how-to — not a news recap. (This lane no longer leads the idea menu — the
outcome history put build stories first — but when a release pick happens, this is the playbook.)

- **Structure: implication → steps → gotcha → outcome.** Lead with what the reader can now *do*
  (the implication), not "X shipped." Then the concrete steps they'd take, the one real gotcha, and
  the outcome. Prescriptive, for the reader (voice-notes → Framing & audience).
- **Real technical meat, accessible entry.** Use real commands, real config, real names — the
  "accessible-but-substantive" bar in `~/.claude/ghostwriter/voice/voice-notes.md`: a curious
  non-expert can follow the entry, an engineer still learns the mechanism. This is what earns
  **saves** (algorithm.md's #1 lever).
- **Authenticity — how-to ≠ "I did this."** A release how-to makes external/world claims, so it is
  exactly the case the source gate is for: the `*.sources.json` sidecar + `verify_sources.py` step
  (step 6) is mandatory. **Never fabricate** or imply the user personally ran a release they
  haven't — write the steps generically ("map which jobs call X"), not as a first-person story.
- **Default visual: text-only, or a carousel when the steps genuinely need slides** (step 8).
  A real how-to earns dwell with its content; a decorative wrapper adds nothing and repeated
  identical branding across the feed is the pattern LinkedIn suppresses. A single composed
  Press card is the exception, not the default — only when the composition itself carries
  information the text can't (a real diagram, real captured output), and only within the
  ~1-in-4 card cap while the recovery protocol is in force.

### Visuals (optional — diagrams & cards)

Only when the user opts in. Requires the diagram dependency (see README; if `render_image.py`
reports Playwright/Chromium is missing, point them at the install step and stop).

**Brand guide (per-user).** Styling + byline live in `~/.claude/ghostwriter/assets/diagram.css` —
the user's personal brand guide, shared across every install of the skill. On first use, if it
doesn't exist, copy it from the template: `mkdir -p ~/.claude/ghostwriter/assets && cp
assets/diagram.css.example ~/.claude/ghostwriter/assets/diagram.css`, then set their `--byline`
(shown at the bottom of every visual), their Press identity (`--press-sig` signature color +
`--stamp` monogram initials), and tweak the palette. Cards use
`<div class="footer brand"></div>` to pull the byline automatically — don't hardcode it.

- **The Press system (THE brand — default for every card).** Editorial-poster identity: warm
  paper canvas, huge black type, serif standfirst, ONE loud signature accent, heavy ink rules,
  giant numerals, an issue-numbered masthead with the personal monogram stamp. Cards are
  **portrait 4:5 (1200×1500)** and **composed, not templated**: read
  `assets/card-language.md` (the component vocabulary, composition rules, and variation axes),
  pick the 2–3 body components that *prove the post's point* (a duel proves a decision, a
  ledger proves a method, a big stat proves a claim, a terminal proves it's real), and author
  a bespoke `images/<slug>.html`. `assets/card-template-press.html` is one example composition
  (the how-to ledger shape), not the shape. **Anti-sameness contract:** before authoring, read
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
     redacted or generalized in the card even though the capture keeps them (same "never
     print secrets" guardrail).
  2. **Author as condensation, never invention.** Keep the session's anatomy — the prompt
     row, the tool-call indicator line, the real table with its actual metric names, values,
     baselines, and deltas, the verdict, the closing directive (see `assets/card-language.md`
     → The hero terminal). Cut whole rows or sections to fit the budget; never smooth real
     output into summary prose, and never "clean up" the texture that makes it real.
  3. **Unknown value → `—` or one question.** Real CLIs print dashes for missing data; do the
     same. If one real number would complete the card (a baseline, a total), ask for that ONE
     number — never invent it, especially health or personal metrics.
  4. **Feed the post too.** Pull the capture's 1–2 strongest real numbers into the draft body
     (re-running the source gate if that adds an external claim) — real specifics are what get
     posts saved and shared.
  5. **Mirror check when a reference exists.** If the user supplied a screenshot or paste,
     then before EVERY showing: Read the reference and the render side by side and enumerate
     the structural mismatches yourself — missing prompt/tool-call lines, missing table
     columns or rows, invented phrasing, dead whitespace where the real session is dense. Fix
     and re-render until you find none; only then show the user. The user saying "closer" is
     the failure mode, not the workflow.
- **The legacy light gallery (reference compositions).** The pre-Press light-system templates
  below remain shipped and renderable — use them as *structural references* when a Press
  composition wants a proven skeleton, or when the user explicitly asks for the light look.
  Two rules still apply when one is used:
    - **The topic graphic is the hero (~3/4); any type-motif is a small accent.** Don't let
      decoration (e.g. the STEM blocks) dominate — the real diagram of THIS post carries the card.
    - **Icons must fit the post.** The `<svg>` icons in every template are EXAMPLES, flagged with
      an `ICONS: …` comment. Pick topic-matching glyphs from `assets/card-icons.md` and swap them
      in for each card — **never ship a template's default icons or placeholder strings**; delete
      the `ICONS:` comment once swapped (the render lint fails the card otherwise). Meaningful and
      few (2–4) beats many.
- **Pick the form — Press composition first; the gallery table below maps legacy shapes.**

  | Post shape | Template | One-liner |
  |---|---|---|
  | **ANY (the default) — compose it** | **`press`** | brand system; pick hero: ledger / duel / pull / bigstat / tiles / term / bars |
  | How-to — 3–5 steps (legacy) | `howto` | numbered spine, icon + command chips |
  | How-to — 4 steps, compact | `howto-grid` | 2×2 numbered tiles |
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
  | Multi-slide step-by-step | `carousel` | PDF document (see Carousels) |

  A **Mermaid diagram** (`--type mermaid`, a `.mmd`) also works for structured/technical content;
  a **designed card** (`--type card`, an `.html`) is the default for one punchy idea. Card templates:
  - `assets/card-template-press.html` — **press (THE default)**: one example composition of the
    Press brand system. Don't fill it in — compose: `assets/card-language.md` documents every
    component (`.ledger`, `.duel`, `.pull`, `.bigstat`, `.facts`, `.tiles`, `.term`, `.bars`,
    `.stand`, `.marginal`), the composition rules, and the variation axes.
  - **The how-to family (4 on-brand layouts — rotate them; never use the same how-to card twice
    in a row).** All share the light system (eyebrow + byline, headline, `.lead`, optional `.band`
    gotcha, `.caption` outcome) and put the real command/flag in a monospace `<code class="cmd">`
    chip — the meat readers save. Pick by step count / rhythm (see the table above):
    - `assets/card-template-howto.html` — **howto (spine, the default)**: `.step` rows on an
      auto-numbered spine, each an icon chip + bold **imperative** `.t` title + a muted `.e` detail
      or a `.cmd` chip. Best 3–5 steps. Reach for it first for a release how-to.
    - `assets/card-template-howto-grid.html` — **howto-grid**: a 2×2 tile grid (`.gstep` = a
      `.gnum` badge + `.gic` topic icon + `.gt` title + `.ge`/`.cmd`). Best with **exactly 4 steps**.
    - `assets/card-template-howto-check.html` — **howto-check**: a saveable checklist on one panel
      (`.check` = a green check + `.ct` title + `.ce`/`.cmd`; the check is the motif, no icon swap).
      Best 4–5 quick steps (6 only if every detail is one line).
    - `assets/card-template-howto-stack.html` — **howto-stack**: an editorial big-number list
      (`.sstep` = a giant ghost numeral + `.st` title + `.se`/`.cmd`). Bold, magazine feel. Best 3–4.
  - `assets/card-template-brief.html` — **brief type (the default explainer)**: the flagship —
    headline + lead, an explainer `.panel` (a before/after `.concept`), a dark thesis `.band`, and
    an icon `.statrow`. Reach for it first for teaching / how-it-works posts.
  - `assets/card-template-flow.html` — **flow type** (architecture / pipeline): light stage chips
    threaded on a numbered spine, each with a **topic icon** + a bold title + one muted example
    (layer classes `.det` green / `.tools` teal / `.agent` blue / `.out` grey). **Prefer over a
    Mermaid diagram for architecture posts.** 3–5 stages; sub-steps inline as `A -> B -> C`.
  - `assets/card-template-matrix.html` — **matrix type** (comparison): a premium scorecard —
    solid colour header pills (`.col-h .green/.grey/.pink`), every value in a contained tile
    (`.v` number / `.vt` phrase), the winning cell per row marked `.best` for an instant verdict;
    `.switch` rows group. Set `cols2`/`cols4` to match the option count (3 is the default);
    translate insider units into plain words.
  - `assets/card-template-ramp.html` — **ramp type** (accelerating progression): a light analytics
    chart — neutral rising bars to an accent payoff bar, a trend line, a delta pill. Bars are
    illustrative; the labeled figures must be accurate.
  - `assets/card-template-date.html` — **date type** (a launch / deprecation / event): a realistic
    ADMIT-ONE ticket as the centerpiece; the headline names the event, the date is the hero.
  - `assets/card-template-brochure.html` — **brochure (a Press composition)**: the product page
    for a shipped release of one of YOUR skills. Masthead → headline → standfirst → `.facts`
    (version, ship date, one proof figure) → `.pull` carrying what the skill **refuses** to do in
    its own words → **both** install steps → colophon, with a slender vertical `.plate` down the
    left third holding an illustration composed for *that* release (ink only — the h1 `.sig` is the
    card's one signature moment). **Start from the scaffold, never by hand:**
    `python3 scripts/release_facts.py <skill> --scaffold images/<slug>.html` writes the card with
    every *factual* slot already filled from the released artifact — version, ship date, both
    install steps, the one rule quoted — and leaves the judgment slots marked `TODO`. Compose the
    plate, the headline, the standfirst and the proof figure; the render lint **fails** while the
    example plate (`id="plate-example"`) survives, so a demo drawing cannot ship. Keep the refusal: a brochure that only lists
    features is an advert.
  - `assets/card-template-stem.html` — **STEM type** (education / outreach): the warm one — a
    SMALL toy-block S·T·E·M accent over a real topic graphic (the build / experiment / result).
    Reach for it when the tone is kid-energy / inspirational.
  - `assets/card-template-code.html` — **code type** (a snippet): a dark macOS terminal floating
    on the light canvas. Highlight by hand (`<span class="t-kw/t-fn/t-str/t-num/t-com">`), mark the
    money line `class="line hot"`, cap with `<span class="caret">`. ≤~42 chars, ≤~10 rows.
  - `assets/card-template-claude.html` — **Claude Code session**: the transcript variant of the
    code type (clay request band, action bullets, `└` result branches). Be honest — real request,
    real outcome; the **Real-output cards** contract applies (capture the actual session first).
  - `assets/card-template-carousel.html` — **carousel type** (a multi-slide document). See
    **Carousels** below — the highest-reach native format, best for educational / step-by-step posts.
  Card styling lives in `~/.claude/ghostwriter/assets/diagram.css` (the brand guide) — use its
  classes, don't add one-off inline CSS. Let the user choose the form if unsure.
- **CONTENT BUDGET (hard limits — the same numbers live in every template header, and the render
  lint enforces the measurable ones):**

  | Template | Count | Field limits | Notes |
  |---|---|---|---|
  | `press` | 2–3 body components | eyebrow ≤24 · h1 ≤2 lines (~13/line; `compact` ~20) · `.stand` ≤3 lines · `.lt` ≤38 · `.le` ≤60 · `.cmdbar` ≤44 one line · `.marginal` ≤2 lines · `.colophon .out` ≤52 · `.term` accent ≤10 rows×42 / hero ≤20 rows×56 | full budgets per component in `assets/card-language.md`; the lint fails misaligned `.term` tables |
  | all light cards | — | eyebrow ≤24, one line · h1 ≤2 lines (~28/line) · caption ≤60 | |
  | `howto` | 3–5 steps | `.t` ≤38 · `.e` ≤60 · `.cmd` ≤45 | 5 steps ⇒ one-line titles + one-line h1 |
  | `howto-stack` | 3–4 | `.st` ≤32 one line · `.se` ≤64 · `.cmd` ≤45 | 4 steps ⇒ ≤2 cmd chips total; 3 steps auto-scale |
  | `howto-grid` | exactly 4 (3 auto-spans) | `.gt` ≤22/line, ≤2 lines · `.cmd` ≤30 | |
  | `howto-check` | 4–6 | `.ct` ≤34 one line · `.ce` ≤66 | 6 rows ⇒ one-line titles AND details |
  | `flow` (light) | 3–5 stages | `.t` ≤34 | 5 ⇒ h1 ≤2 lines, one-line titles |
  | `matrix` (light) | 2–4 options, ≤5 rows | set `cols2`/`cols4` to match | 6–7 rows ⇒ class `dense` |
  | `ramp` | 3 bars | `.val` ≤7 chars, dates ≤10 | units go in the kicker |
  | `brief` | keep all blocks | h1 ≤2 · lead ≤3 lines · scol `.cap` 1 line | |
  | `stem` | ≤2 nodes + ≤3 scols when lead ≥3 lines | | |
  | `code`/`claude` | ≤10 rows | ≤42 chars/line | ask band + final caret line must fit |
  | `date` | — | date-sub ≤40 chars | |
  | `brochure` (press) | exactly 3 facts | `.fval` ≤11 beside the plate · `.pull .q` ≤3 lines · **2** `.cmdbar` ≤52 each · `.stand` ≤4 lines · plate `viewBox="0 0 300 900"` | needs one `.pull .q`, one `.plate svg`, and BOTH install steps; facts come from `release_facts.py`, never typed |
  | `carousel` | 7–9 slides | ≤30 words/slide | `--i`/`--n` and pageno text must match count |

  Count-adaptive layouts (stack/howto/check/flow at 3, grid at 3, matrix `cols2`/`cols4`/`dense`)
  are automatic or one class — the budget table says which.
- **Author the source** into `images/<slug>.mmd` or `images/<slug>.html`. Keep it to one idea;
  **never invent structure, numbers, or relationships that aren't true** (same authenticity rule
  as `~/.claude/ghostwriter/voice/voice-notes.md` — a misleading diagram is worse than none).
  **Card copy follows the voice rules too**: the voice-notes bans (em dashes, hedge words,
  clever-symmetry lines) apply to every headline, lead, band, and caption, not just the post body.
- **Render:** `.venv/bin/python scripts/render_image.py --type <mermaid|card> --in images/<slug>.<ext> --out images/<slug>.png`
  — `--size 1200x1500` is the default (a viewport hint; the screenshot crops to `#canvas`, and
  Mermaid auto-fits), so cards need no size flag. Pass `--strict` on the pre-publish render so any
  lint FAIL exits non-zero. **Never pass `--no-open` in an interactive Generate session** — the
  command auto-opens the PNG in the user's own image viewer by default, and that auto-open (not a
  chat-embedded copy) is how the user actually sees it full-size on their own screen. `--no-open`
  is for headless/batch/CI use only; adding it "to be safe" during a normal session just makes the
  user ask to see something that should have opened on its own — if a render command in this file
  ever produced a PNG without opening it, run `open images/<slug>.png` (macOS) immediately after.
- **MANDATORY: after every render, Read the PNG yourself and judge it like an art director BEFORE
  showing the user** — check: content fills the 1500px frame with even rhythm (no band of dead
  space > ~180px), nothing clipped at any edge, no ellipsized command or code, eyebrow and titles
  on one line, no widow words, one dominant accent. Fix and re-render until you'd publish it; the
  user sees only cards that already pass. The render command prints WARN/FAIL lint lines — treat
  every FAIL as a defect, not a suggestion.
- **Show the user the rendered PNG** and iterate (tweak the source or
  `~/.claude/ghostwriter/assets/diagram.css`) until they approve it. Don't claim it looks good
  without showing the image. **On approval, append the card's fingerprint to
  `images/card-history.jsonl`** (see `assets/card-language.md`) — that file is what keeps the
  next card from repeating this one.
- **Write alt text** describing the visual; you'll pass it to the publish step.

#### Carousels (multi-slide documents — highest reach)

A carousel is a multi-page PDF posted as a **document** — the highest-reach native format and
the best visual for educational / how-to / step-by-step posts. The template is **portrait 4:5
(1200×1500)** to own the mobile feed. Workflow:

1. **Author** `images/<slug>-carousel.html` from `assets/card-template-carousel.html`, following
   the blueprint: **cover (hook) → 4–6 numbered `.point` slides → a `.recap` list → a `.cta`**.
   Add `press` to every slide's class list so the deck wears the brand (paper canvas, ink
   rules, the signature accent).
   One idea per slide, **≤~30 words/slide**, **7–9 slides**. Set `--i` (this slide's number) and
   `--n` (total) on every `.slide` via `style="…"` — they drive the **progress bar** only. The
   `NN / TOTAL` page counter is literal text you keep in sync by hand; keep `--n` equal to your
   real slide count. The series `.eyebrow` and the
   byline repeat on every slide for branding. End on **ONE action** — default to a single comment
   question (comments are the #1 reach signal); swap to "Save this" if saves fit better. Same
   authenticity rule: never invent numbers or structure.
2. **Render:** `.venv/bin/python scripts/render_carousel.py --in images/<slug>-carousel.html --out images/<slug>.pdf`
   — writes preview PNGs (`images/<slug>-NN.png`) and the `images/<slug>.pdf` to post, and opens
   the PDF.
3. **Show the slides** and iterate until approved (don't claim it looks good without showing it).
4. **Publish** with `--document` (see Publish mode). The post body (`commentary`) is still the
   draft text; the carousel rides along as the document.

### Engagement craft (apply to every draft)

The full, sourced rationale is in `voice/algorithm.md` — read it. The essentials:

- **Hook in the first ~210 characters (2–3 short lines).** That is all that shows before
  "…see more", and it decides reach. A sharp claim, a specific number, a tension, or a story
  cold-open. No throat-clearing ("I've been thinking lately...").
- **One idea per post.** Cut anything that isn't serving the single point.
- **Optimize for SAVES, not applause.** Saves are worth ~5× a like and drive the most reach.
  Make the post reference-worthy: a framework, a "how to", a reusable mental model the reader
  wants to keep. This is how we chase the algorithm without resorting to engagement bait.
- **Teach something.** Knowledge/advice content gets ~3–5× the reach. Prescriptive, for the
  reader (see voice-notes), not autobiographical.
- **Specifics over abstractions.** Real numbers, real moments, real names of things.
- **Feed-native formatting.** LinkedIn is read on phones: one idea per line or a 1–2 sentence
  paragraph, blank line between, no paragraph over ~40 words, ~8th-grade reading level (denser
  than 10th grade ≈ 35% less reach). An essay in paragraph blocks fails the pre-show check.
- **No external links in the post body** (a single in-body link cuts reach ~60%). The
  link-in-first-comment workaround is reportedly detected as of early 2026 — it still beats an
  in-body link, but first ask whether the post needs the link at all.
- **Earn the ending on substance.** The last real point, a line worth keeping, or a **genuine
  question the user actually wants answered** — a real question is a first-class ending and the
  main compliant way a post earns comments (voice-notes → Recalibration 2026-08-19). What stays
  banned is the reflexive shape: "Thoughts? 👇", "what's your…?", "how do you…?" as a tacked-on
  closer.
- **Sound human — warmth is a positive property, not the absence of tells.** No "In today's
  fast-paced world", no "game-changer", no "delve", no manufactured humility; but avoiding
  those only gets a draft to neutral. Human means: open on the situation or the human reason,
  name the real thing in plain words, first-person narration, mild self-deprecation where it's
  true, everyday words over clinical ones (see voice-notes → Register). If it reads like AI
  *or* like an incident report, rewrite it. Match the profile's "Never do" list.
- **Length: default 50–120 words** — the voice-notes default wins over algorithm.md's longer
  ~900–1,500-char "sweet spot," which applies only when the post genuinely needs the room (e.g.
  a multi-step how-to) and never as padding. Hard cap 3000 chars (the script enforces it).
- **Hashtags: 0–3, specific.** They barely help now and 6+ hurt; default to none unless the
  voice profile says otherwise.

---

## Mode: Publish

Only after the user explicitly approves a specific draft.

0. **Timing, cadence, and engagement-window gates (recommend, never block).** Before running
   the publish command, check the clock and `published.jsonl` (the script prints the same
   warnings, but surface them *before* the moment of publishing, not after):
   - **Off-window** — outside weekdays ~7:00–13:00 local (Tue–Thu best): say so and recommend
     holding until the next window. Friday night and weekend posts were a real pattern in the
     first 20 posts and they land in dead air. (The window is a default from aggregate data —
     refine it from the user's own impressions numbers as the outcome log fills in.)
   - **Cadence** — >3 posts in the trailing 7 days, or <20 hours since the last publish:
     say so and recommend holding (two posts within 24h split the test-audience evaluation
     and hurt both).
   - **Engagement window** — ask whether the user has 10–15 minutes right after publishing to
     reply to comments and leave 5+ substantive comments on posts their audience reads. If
     not, recommend publishing when they do: early engagement decides distribution, and a
     printed reminder demonstrably didn't change behavior across the first 20 posts.
   The user can override any of these with a word — they are recommendations, and the
   compliance rule stands: the post publishes only when the user says so, never on a schedule.
1. **Preview the payload** (optional sanity check):
   `python3 scripts/linkedin_post.py --file drafts/<file>.md --dry-run`
2. **Publish:** `python3 scripts/linkedin_post.py --file drafts/<file>.md --lane <lane>`
   — pass the post's content lane (`release-howto` / `personal-project` / `opinion` / `career` /
   `personal`) so the publish log (`~/.claude/ghostwriter/published.jsonl`, written automatically
   on success) can feed the outcome loop. Omitting `--lane` still publishes.
   - **Source gate runs automatically.** A real (non-dry-run) `--file` publish is refused unless the
     draft's `*.sources.json` sidecar passes `verify_sources.py` (≥3 distinct live hosts, every claim
     sourced, or `external_claims:false`). If it fails, **fix the sidecar / redo the research step,
     not the gate** — re-run Generate step 6, then retry. A bare `--text`/stdin publish is refused by
     design (nothing to verify). Do **not** reach for `--allow-unverified` to get past a failure.
   - **AI-fingerprint gate runs automatically too.** The publish is refused while any
     `scripts/ai_tells.py` FAIL rule fires on the text being posted (deterministic rules only; the
     judge belongs to step 7 where there is still a draft to rewrite). If it fails, **fix the draft
     and re-show it, not the gate**. Do **not** reach for `--allow-ai-tells` to get past a failure.
   - **With an approved single image** (only if the user opted in and approved the PNG), add
     `--image images/<slug>.png --alt "<alt text>"`.
   - **With an approved carousel**, add `--document images/<slug>.pdf --title "<short title>"`
     instead (image and document are mutually exclusive). Prefer the carousel for educational
     posts (higher reach). Always `--dry-run` once first; document upload is the same flow as
     images but posts to `/rest/documents`.
   - Never attach a visual the user hasn't seen and approved; if it changes, re-show and re-confirm.
3. **Report** the result. On success, share the post URL the script prints. On an auth error
   (HTTP 401/403), tell the user to re-run `python3 scripts/linkedin_auth.py` (token likely
   expired after ~60 days), then retry.
4. **Walk the golden hour, don't just mention it.** Reach is largely decided in the first
   30–90 minutes (see `voice/algorithm.md`), and the engagement window was already committed
   at gate 0. After sharing the URL, hand the user the concrete checklist for the next hour:
   reply to every comment with substance (a question back, not just "thanks"); leave 5+
   thoughtful 10+ word comments on posts their target audience reads (the strongest
   distribution lever a smaller account has); and if the post references a link, weigh
   dropping it in the first comment (better than in-body, though the workaround is reportedly
   detected now). The script can't do these, and COMPLIANCE.md forbids automating them — they
   are the user's half of the reach equation, and the half that was skipped on all 20 posts
   to date.

Never run the non-`--dry-run` publish command without a clear, specific approval from the user
for that exact draft.

---

## Guardrails

- **Never publish without explicit approval** of the specific text. Editing the draft → re-show
  → re-confirm.
- **The user must be able to read the ENTIRE post at the moment of approval** — first show and
  every re-show. A post that fits the preview pane unclipped (≤ ~9 lines) rides in the approval
  dialog itself; a longer post is printed complete in the message immediately before the dialog,
  with the question naming the line count and final line so the user can verify nothing is
  hidden. Text the preview pane clips does not count as shown, and neither does text left only
  in distant scrollback (see Generate step 7 — both failure modes came from real sessions).
- **Never print or commit secrets.** `.env`, `data/`, and `drafts/` are gitignored; keep it that
  way. Don't echo the access token or client secret in chat.
- **Don't fabricate facts** in posts — no invented metrics, quotes, or events. **Every
  external/world claim must clear the source contract** (Generate step 6): ≥3 distinct live,
  reputable sources recorded in the draft's `*.sources.json` sidecar and confirmed to *support* the
  claim, enforced at publish by `verify_sources.py`. Sources stay in the sidecar, **never in the post
  body**. If you can't source a claim, cut it — don't ship it.
- **`--allow-unverified` is human-only.** It is the single bypass of the source gate and exists for a
  human to override a genuine edge case (e.g. a real source transiently down). **The agent must
  never set it to get past a failed gate** — fix the sidecar / redo the research instead (same
  spirit as "never publish without explicit approval").
- **Every post runs through the AI-fingerprint gate before it is shown and before it publishes**
  (`scripts/ai_tells.py`, Generate step 7). **`--allow-ai-tells` is human-only** — the single bypass
  of that gate at publish, for a human who has read the finding and wants the line anyway. **The
  agent must never set it** — rewrite the draft, re-run the gate, re-show.
- **One post per request** unless the user asks for several.
- **Compliance (LinkedIn API ToS §3.1) — never automate posting.** Every post must be
  member-initiated and explicitly approved by the user, one at a time. Do NOT set up scheduled,
  looped, cron, or unattended posting; do NOT scrape LinkedIn for voice data or topics (use the
  official data export only). Removing the human approval step would violate the terms. See
  `COMPLIANCE.md`. If the user asks for autonomous auto-posting, decline and explain this.
