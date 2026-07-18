---
name: ghostwriter
version: 0.11.0
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
record is **≥2 days old and has no `outcome`**, ask ONE `AskUserQuestion` — *"How did
'<first_line>' do?"* with options great / normal / flopped (notes via "Other") — then record it:
`python3 scripts/post_outcome.py --latest --outcome <answer> --notes "<notes>"`. Never ask more
than once per session; nothing to score → skip silently, don't mention it. **Use the accumulated
outcomes everywhere you choose:** lean the idea menu toward lanes that scored `great` and away
from repeated `flopped`, and let format outcomes steer the visual-form recommendation (step 8).
Say why when it's relevant ("your last carousel did great"). This is the only compliant
performance signal we have (no scraping — COMPLIANCE.md), so actually use it.

1. **Short-circuit if the topic is already concrete.** If the user named a specific topic, pointed
   you at a source, or said "draft a post from item N in the radar," skip the menu and go straight
   to grounding + drafting (step 3). The menu below is the default only for an open-ended "write me
   a post."
2. **No topic given → offer ONE rich idea menu.** Don't make the user pick a lane and then drill;
   gather concrete, ready-to-write ideas from every source *yourself*, then present them in a
   **single `AskUserQuestion`** (single-select; the auto "Other" lets them type their own topic).
   Aim for **~5–6 options**, each a short title + its one-line hook, **led by recent-AI-release
   how-tos** (the priority lane):
   - **First, check radar health — never serve stale research silently.** Read the newest
     `research/release-radar-*.md` date and the tail of `research/.radar.log`. Tell the user the
     provenance in one line before (or in the intro of) the menu: fresh → *"ideas from the Jul 17
     radar"*; **stale (>4 days) or missing** → say so, note whether the log shows the scheduled
     job failing, and fall back to a live search (below). If the job is broken (e.g. exit 127 —
     usually the repo moved), offer to repair it: `bash scripts/install_radar.sh` re-renders the
     launchd agent against the repo's current path. **Label every menu option with its source**
     (radar + digest date / live search + today / your repo / interests) so the user can judge
     freshness at a glance.
   - **~3–4 how-to ideas from the newest `research/release-radar-*.md` digest** — reuse each item's
     title + "suggested angle" (already how-to-shaped and source-backed). The pick's facts +
     suggested angle are the anchor, pre-sourced by the twice-weekly research job
     (`scripts/release_radar.sh`), which scans the **broader AI industry**, not just Anthropic.
     Never add experience claims the digest didn't establish. The digest's **Discussion radar**
     items feed the opinion/hot-take slot below the same way. **No fresh digest?** Do a quick live
     web search over `~/.claude/ghostwriter/voice/interests.md`'s trending areas, find 2–4 genuinely
     noteworthy developments, and use those for the how-to slots.
   - **~1 personal-project idea** — run `python3 scripts/recent_projects.py`, take the top repo with
     recent Claude Code sessions, and read its recent `git log` + last session summary for the
     **one real thing shipped** (that's the anchor). Respect
     `~/.claude/ghostwriter/voice/interests.md` → **Off-limits**: never surface or post anything
     work-confidential (e.g. GoodLeap internals); personal/OSS repos only.
   - **~1 interests / hot-take idea** — read `~/.claude/ghostwriter/voice/interests.md` (core
     themes, hot takes, stories) for one specific angle not covered recently.

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
   Fix what fails, then **show the full draft** in chat and ask: *"Publish this to LinkedIn,
   edit it, or scrap it?"* Wait for their answer. Do not publish unprompted.
   **Any voice/style feedback the user gives — append it to
   `~/.claude/ghostwriter/voice/voice-notes.md` in the same turn, BEFORE redrafting,** and say
   you did ("added to voice notes"). Fixing only the draft loses the correction and the user has
   to repeat it next session.
8. **Settle the visual with ONE question — build nothing first.** After the text is approved,
   ask a single `AskUserQuestion`: **text-only** / **single card** (name the layout you'd pick) /
   **carousel** — with your recommendation first, chosen from the post's shape and the outcome
   history: how-to / educational → **carousel** (highest-reach native format, see
   `voice/algorithm.md`) or a how-to card; one punchy idea → card; personal story → text-only.
   A strong text post beats a weak image, so text-only is always a respectable pick. Only after
   the pick do you author and render (see **Visuals**); never render a form the user didn't
   choose. For how-to cards, **rotate the four layouts** (spine / grid / checklist / stack) so
   posts don't repeat (see **Visuals → the card-type table**).

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
- **Default visual: the how-to card family** (step 8) — a single high-quality image. **Rotate the
  four layouts** (`howto` spine / `howto-grid` / `howto-check` / `howto-stack`) so how-to posts
  never look the same twice in a row; pick by step count (see Visuals → the card-type table).

### Visuals (optional — diagrams & cards)

Only when the user opts in. Requires the diagram dependency (see README; if `render_image.py`
reports Playwright/Chromium is missing, point them at the install step and stop).

**Brand guide (per-user).** Styling + byline live in `~/.claude/ghostwriter/assets/diagram.css` —
the user's personal brand guide, shared across every install of the skill. On first use, if it
doesn't exist, copy it from the template: `mkdir -p ~/.claude/ghostwriter/assets && cp
assets/diagram.css.example ~/.claude/ghostwriter/assets/diagram.css`, then set their `--byline`
(shown at the bottom of every visual) and tweak the palette. Cards use
`<div class="footer brand"></div>` to pull the byline automatically — don't hardcode it.

- **The light card system.** Every designed card uses the modern **light** system: a light
  canvas, layered white panels, a dark callout band, real line icons, and a restrained hierarchy.
  Cards are **portrait 4:5 (1200×1500)** and share one rhythm — eyebrow + byline → restrained
  headline → a **lead** paragraph (bold the key phrase) → the **topic graphic** that fills the
  body → an anchored **footer caption**. Two rules keep them premium:
    - **The topic graphic is the hero (~3/4); any type-motif is a small accent.** Don't let
      decoration (e.g. the STEM blocks) dominate — the real diagram of THIS post carries the card.
    - **Icons must fit the post.** The `<svg>` icons in every template are EXAMPLES, flagged with
      an `ICONS: …` comment. Pick topic-matching glyphs from `assets/card-icons.md` and swap them
      in for each card — **never ship a template's default icons or placeholder strings**; delete
      the `ICONS:` comment once swapped (the render lint fails the card otherwise). Meaningful and
      few (2–4) beats many.
- **Pick the form — glance at this table first, then read the matching bullet below.**

  | Post shape | Template | One-liner |
  |---|---|---|
  | **How-to — default / 3–5 steps** | **`howto`** | numbered spine, icon + command chips |
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
    real outcome.
  - `assets/card-template-carousel.html` — **carousel type** (a multi-slide document). See
    **Carousels** below — the highest-reach native format, best for educational / step-by-step posts.
  Card styling lives in `~/.claude/ghostwriter/assets/diagram.css` (the brand guide) — use its
  classes, don't add one-off inline CSS. Let the user choose the form if unsure.
- **CONTENT BUDGET (hard limits — the same numbers live in every template header, and the render
  lint enforces the measurable ones):**

  | Template | Count | Field limits | Notes |
  |---|---|---|---|
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
  lint FAIL exits non-zero. This **auto-opens the PNG in the user's image viewer** so they can
  actually see it (pass `--no-open` only for headless/batch use).
- **MANDATORY: after every render, Read the PNG yourself and judge it like an art director BEFORE
  showing the user** — check: content fills the 1500px frame with even rhythm (no band of dead
  space > ~180px), nothing clipped at any edge, no ellipsized command or code, eyebrow and titles
  on one line, no widow words, one dominant accent. Fix and re-render until you'd publish it; the
  user sees only cards that already pass. The render command prints WARN/FAIL lint lines — treat
  every FAIL as a defect, not a suggestion.
- **Show the user the rendered PNG** and iterate (tweak the source or
  `~/.claude/ghostwriter/assets/diagram.css`) until they approve it. Don't claim it looks good
  without showing the image.
- **Write alt text** describing the visual; you'll pass it to the publish step.

#### Carousels (multi-slide documents — highest reach)

A carousel is a multi-page PDF posted as a **document** — the highest-reach native format and
the best visual for educational / how-to / step-by-step posts. The template is **portrait 4:5
(1200×1500)** to own the mobile feed. Workflow:

1. **Author** `images/<slug>-carousel.html` from `assets/card-template-carousel.html`, following
   the blueprint: **cover (hook) → 4–6 numbered `.point` slides → a `.recap` list → a `.cta`**.
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
