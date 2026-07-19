---
name: ghostwriter
version: 0.14.0
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

**Outcome check-in (max one, fast — the feedback loop).** Before anything else, read
`~/.claude/ghostwriter/published.jsonl` (written automatically on every publish). If the newest
record is **≥2 days old and has no `outcome`**, ask ONE check-in question — *"How did
'<first_line>' do?"* with options great / normal / flopped (notes via "Other") — then record it:
`python3 scripts/post_outcome.py --latest --outcome <answer> --notes "<notes>"`. **One dialog to
start: if the idea menu (step 2) is also due, the check-in and the menu ride in the SAME single
`AskUserQuestion` call** — the check-in takes the first question slot and the menu compresses to
three lane questions that day (see step 2) — one dialog, one round trip, never two sequential
question dialogs to get a session moving. Only when no menu is due (the topic came in concrete)
may the check-in be its own question. Never ask more
than once per session; nothing to score → skip silently, don't mention it. **Use the accumulated
outcomes everywhere you choose:** lean the idea menu toward lanes that scored `great` and away
from repeated `flopped`, and let format outcomes steer the visual-form recommendation (step 8).
Say why when it's relevant ("your last carousel did great"). This is the only compliant
performance signal we have (no scraping — COMPLIANCE.md), so actually use it.

1. **Short-circuit if the topic is already concrete.** If the user named a specific topic, pointed
   you at a source, or said "draft a post from item N in the radar," skip the menu and go straight
   to grounding + drafting (step 3). The menu below is the default only for an open-ended "write me
   a post."
2. **No topic given → ONE four-section menu dialog. The picker IS the board.** Gather concrete,
   ready-to-write ideas from the four lanes below *yourself*, then present them in a **single
   `AskUserQuestion` call with one question per lane** — headers **`Trending`**, **`Radar`**,
   **`Interests`**, **`Projects`** — so the user opens one dialog and sees every section with
   **8–12 previewed ideas total**, not a 4-item shortlist. Rules of the dialog:
   - Each lane question is single-select with **up to 3 ideas + a "Pass" option** ("nothing from
     this lane today"); the auto "Other" on any lane takes a typed topic. The user picks in one
     lane and passes the rest. If they pick in several lanes, draft the pick from the
     highest-priority lane (lane order below, bent by outcome history) and say the other picks
     are ready to draft on request — one post per request still holds.
   - **Every idea option carries a `preview`** (≤ ~9 lines so the pane never clips): the working
     hook (the post's first ~2 lines as they'd actually read), the suggested angle in one
     sentence, and a source-freshness line (e.g. `radar · Jul 17 · anthropic.com`). A user
     should be able to pick on previews alone.
   - **Intro text stays to one provenance line per lane** (radar date + job health, live-search
     date, repo names) — don't dump a duplicate board into chat; the dialog carries the ideas.
   - **When the outcome check-in is due** it takes the first question slot (the call caps at 4
     questions): that day, fold the Interests lane's best idea into the Trending question so
     everything still fits one dialog.
   - A lane with nothing real today shows fewer ideas or gives its question slot to the next
     strongest lane — say so in the provenance line, and never pad with weak ideas.

   The four lanes, in priority order:
   - **Trending now (live, run-day — always research this).** Do a quick live web search TODAY
     over the trending areas in `~/.claude/ghostwriter/voice/interests.md` — what's actually
     moving this week on social/discussion surfaces (X, Hacker News, Reddit), in Google/news
     coverage, and in LinkedIn-adjacent industry conversation. Propose **2–3 trending topics**,
     each with the specific angle the user could own (tie it to their core themes or hot takes —
     a trending topic without their angle is just news). Label each `trending · <today> · <host>`.
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
   - **Interests & hot takes (1–3 entries).** Read `~/.claude/ghostwriter/voice/interests.md` —
     core themes, the "Strong opinions" list, and the story bank — for specific angles not
     covered recently (check `published.jsonl` and recent drafts). A strong uncovered story-bank
     item beats a generic theme; label each `interests · <theme or story>`.
   - **Your recent Claude projects (2–3 entries).** Run `python3 scripts/recent_projects.py` and
     take the top 2–3 repos with recent Claude Code sessions; for each, read the recent `git log`
     + last session summary for the **one real thing shipped** (that's the anchor). Respect
     `~/.claude/ghostwriter/voice/interests.md` → **Off-limits**: never surface or post anything
     work-confidential (e.g. GoodLeap internals); personal/OSS repos only.

   The tapped idea is the post's concrete anchor → go straight to grounding + draft (step 3). No
   second drill. If the user picks a release how-to, follow the **How-to posts** playbook below.
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
     sidecar before publishing.
7. **Pre-show self-check, then show the draft.** Before the user sees it, verify against
   `~/.claude/ghostwriter/voice/voice-notes.md`, hardest first:
   - **The ending** — the #1 AI tell, flagged more than anything else. The post stops on the
     last real point. No inverted-parallel closer, no clever-symmetry aphorism, no reflexive
     "what's your…?" CTA.
   - **Nothing fabricated** — no invented details, motivations, or timeline drama the user
     didn't actually live.
   - **Length** — default 50–120 words (see Engagement craft).
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
   - One metadata line under the block: `N words · save: <the thing a reader keeps> · lane: <lane>`.
   - **Re-shows lead with the delta:** after any edit, the first line is
     `Changed: <one-line summary>`, then the full draft in the same format — the user should never
     re-read the whole post hunting for the edit.
   Then ask with a single `AskUserQuestion` — options **Publish** / **Edit** (the auto "Other"
   takes typed edit instructions directly) / **Scrap** — and wait for the answer. The Publish tap
   immediately after seeing the exact full text is the explicit approval; an edited draft is
   re-shown and re-asked the same way. Do not publish unprompted.
   **Any voice/style feedback the user gives — append it to
   `~/.claude/ghostwriter/voice/voice-notes.md` in the same turn, BEFORE redrafting,** and say
   you did ("added to voice notes"). Fixing only the draft loses the correction and the user has
   to repeat it next session.
8. **Settle the visual with ONE question — build nothing first.** After the text is approved,
   ask a single `AskUserQuestion`: **text-only** / **single card** (name the Press hero
   component you'd compose around, e.g. "a duel" or "a ledger") / **carousel** — with your
   recommendation first, chosen from the post's shape and the outcome history: how-to /
   educational → **carousel** (highest-reach native format, see `voice/algorithm.md`) or a
   composed Press card; one punchy idea → card; personal story → text-only. A strong text post
   beats a weak image, so text-only is always a respectable pick. **Give every option an ASCII
   `preview` sketch of what THIS post would get:** the card option sketches the actual proposed
   Press composition as labeled blocks (masthead / hero / colophon, with this post's real
   headline and hero named, e.g. `[ DUEL: cron vs launchd ]`); the carousel option sketches the
   slide strip (`cover → 5 steps → recap → CTA`, using this post's slide titles); text-only
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

The priority lane, and the one radar items feed directly. When the anchor is a recent AI release,
write a genuine how-to — not a news recap.

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
- **Default visual: a composed Press card** (step 8) — a single high-quality image, usually
  built around a **ledger** (numbered steps + the real command in a `.cmdbar`) or **tiles**
  (exactly 4 compact steps). Compose it fresh per `assets/card-language.md` and vary the
  composition against `images/card-history.jsonl` so how-to posts never look the same twice
  in a row.

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
- **Short lines, white space.** LinkedIn is read on phones. Paragraphs ≤3–4 lines, ~8th-grade
  reading level (denser than 10th grade ≈ 35% less reach).
- **No external links in the post body** (a single in-body link cuts reach ~50–70%). If a link
  is needed, leave it out and tell the user to drop it in the **first comment**.
- **Earn the ending on substance.** A line worth re-sharing, or a genuine question only when it
  truly is the strongest ending — never a reflexive "Thoughts? 👇" (voice-notes forbids it).
- **Sound human.** No "In today's fast-paced world", no "game-changer", no "delve", no
  manufactured humility. If it reads like AI, rewrite it. Match the profile's "Never do" list.
- **Length: default 50–120 words** — the voice-notes default wins over algorithm.md's longer
  ~900–1,500-char "sweet spot," which applies only when the post genuinely needs the room (e.g.
  a multi-step how-to) and never as padding. Hard cap 3000 chars (the script enforces it).
- **Hashtags: 0–3, specific.** They barely help now and 6+ hurt; default to none unless the
  voice profile says otherwise.

---

## Mode: Publish

Only after the user explicitly approves a specific draft.

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
4. **Prompt the golden hour.** Reach is largely decided in the first 30–60 minutes (see
   `voice/algorithm.md`). After sharing the URL, remind the user to, in the next hour:
   reply to every comment with substance (a question back, not just "thanks"), go comment on
   5+ other people's posts to signal activity, and — if the post references a link — drop that
   link in the **first comment** now (links in the body suppress reach). The script can't do
   these; they are the single biggest fix for low reach.

Never run the non-`--dry-run` publish command without a clear, specific approval from the user
for that exact draft.

---

## Guardrails

- **Never publish without explicit approval** of the specific text. Editing the draft → re-show
  → re-confirm.
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
- **One post per request** unless the user asks for several.
- **Compliance (LinkedIn API ToS §3.1) — never automate posting.** Every post must be
  member-initiated and explicitly approved by the user, one at a time. Do NOT set up scheduled,
  looped, cron, or unattended posting; do NOT scrape LinkedIn for voice data or topics (use the
  official data export only). Removing the human approval step would violate the terms. See
  `COMPLIANCE.md`. If the user asks for autonomous auto-posting, decline and explain this.
