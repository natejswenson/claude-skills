---
name: ghostwriter
version: 0.7.0
user_invocable: true
description: Write engaging LinkedIn posts in the user's own voice and publish them to their profile after they approve. Use when the user wants to draft, write, or post something to LinkedIn, asks for a "LinkedIn post", wants content about trending topics in their field, or wants to set up / configure LinkedIn auto-posting. Learns the user's voice from their past posts and never publishes without explicit approval.
---

# LinkedIn Ghostwriter

Draft LinkedIn posts that sound like the user, then publish to their own profile via
LinkedIn's official API — **only after they approve the draft**. Never auto-publish.

The repo root is the directory containing this skill's `scripts/`, `voice/`, and `drafts/`
folders. All commands below are run from that repo root.

## Decide which mode you're in

- **Setup** — `.env` has no `LINKEDIN_ACCESS_TOKEN`, or `voice/voice-profile.md` is missing,
  or the user says "set up", "configure", "connect my LinkedIn". → Run **Setup**.
- **Generate** — the user wants a post (the common case). → Run **Generate**.
- **Publish** — the user approves a draft you already showed. → Run **Publish**.

Before generating, quietly confirm setup is done: `voice/voice-profile.md` exists and `.env`
contains `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PERSON_URN`. If not, switch to Setup.

---

## Mode: Setup

Walk the user through this once. Do the steps you can; hand them the steps only they can do.

1. **LinkedIn app.** Ask them to create an app at <https://www.linkedin.com/developers/apps>,
   add the **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** products,
   and under **Auth** add the redirect URL `http://localhost:8765/callback`. They give you the
   **Client ID** and **Client Secret**.
2. **.env.** Run `cp .env.example .env`, then write their Client ID/Secret into `.env`
   (edit the file; never echo the secret back in chat).
3. **Authorize.** Tell them to run `python3 scripts/linkedin_auth.py` themselves (it opens a
   browser for them to click "Allow"). It writes the token + person URN into `.env`.
4. **Export posts.** Tell them to request their data from LinkedIn (Settings → Data privacy →
   *Get a copy of your data* → **Posts**), and drop the resulting `Shares.csv` into `data/`.
   The email takes ~10 minutes.
5. **Extract.** Once `data/Shares.csv` exists, run `python3 scripts/extract_posts.py`.
6. **Build the voice profile.** Do the **Voice Profile** step below.
7. **Interests & voice notes.** If they don't exist yet (e.g. a fresh clone), seed them from
   the templates: `cp voice/interests.example.md voice/interests.md` and
   `cp voice/voice-notes.example.md voice/voice-notes.md`. Then help them fill in
   `voice/interests.md` (interview them if it's empty). `voice-notes.md` ships with sensible
   defaults; append the user's own feedback to it as it comes up.

If the user has no usable export (few/no past posts), skip 4–5 and build `voice-profile.md`
by interviewing them: ask about tone, the 3–5 topics they're known for, formatting habits
(emoji? hashtags? short lines?), and what they never want to sound like.

### Voice Profile (the heart of "sounds like me")

Read `data/my_posts.md` in full, then write `voice/voice-profile.md` capturing:

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

**Posture: propose, don't interrogate.** The default is *you* surface 3–4 concrete, already-real
ideas and the user taps one — not a blank "what do you want to post about?" The picked idea is the
post's real anchor, so there's no generic interview.

1. **Short-circuit if the topic is already concrete.** If the user named a specific topic, pointed
   you at a source, or said "draft a post from item N in the radar," skip the menu and go straight
   to grounding + drafting (step 3). The menu below is the default for an open-ended "write me a
   post."
2. **Propose ideas — a two-tier menu.**

   **Tier 1 — pick a lane** (`AskUserQuestion`, single-select; the auto "Other" option lets them
   type a topic directly):
   - **Radar** — "React to something new in AI this week." (recent AI-industry news)
   - **Personal project** — "Post about something you actually shipped recently."
   - **Interests / hot take** — "An evergreen theme or opinion you haven't posted lately."

   **Tier 2 — drill to a concrete anchor** (depends on the lane; present the choices as another
   `AskUserQuestion` so it's one tap):
   - **Radar →** read the newest `research/release-radar-*.md` digest and present its 2–4 items
     (title + the one-line "why it matters") as options. The pick's facts + suggested angle are the
     anchor — pre-sourced by the twice-weekly research job (`scripts/release_radar.sh`), which now
     scans the **broader AI industry**, not just Anthropic. Still apply the voice rules below and
     never add experience claims the digest didn't establish. **No digest yet?** Offer to do a live
     web search over `voice/interests.md`'s trending areas, find 2–4 genuinely noteworthy
     developments, and present those the same way.
   - **Personal project →** run `python3 scripts/recent_projects.py` to list local repos that
     recently had Claude Code sessions, and present the top ~4 (name, branch, last commit) as
     options. When they pick one, read that repo's recent `git log` and last session summary to find
     the **one real thing they built/shipped** — that's the anchor. Respect `voice/interests.md` →
     **Off-limits**: never surface or post anything work-confidential (e.g. GoodLeap internals);
     personal/OSS repos only.
   - **Interests / hot take →** read `voice/interests.md` (core themes, hot takes, stories) and
     present 3–4 specific angles they haven't covered recently as options. The pick is the anchor.
3. **Confirm the anchor, then draft.** Every post still needs **one concrete, real, first-person
   anchor** — the actual tool, a real number, a specific decision, a thing that actually happened
   (see voice-notes.md → Substance bar + Authenticity). The menu pick normally *is* that anchor.
   Only the personal-project lane sometimes needs a single sharp follow-up to nail the specific
   detail — ask **one** `AskUserQuestion`, never the old generic 2–3-question interview. **Never
   fabricate a detail to clear this bar.** If there's genuinely no real anchor, say so rather than
   shipping a generic post.
4. **Draft against the voice profile.** Read `voice/voice-notes.md`, `voice/voice-profile.md`,
   AND `voice/algorithm.md` first, every time (voice-notes.md holds direct user feedback and
   takes priority; algorithm.md is reach optimization and must never override voice). If a voice
   file is missing — e.g. a fresh setup — copy `voice/voice-notes.example.md` to
   `voice/voice-notes.md` and proceed with what you have (`voice/interests.md` plus the
   defaults). Write the
   post to match them — their openers, rhythm, formatting, emoji/hashtag habits. Apply the
   **Engagement craft** rules below AND the reach rules in `voice/algorithm.md` (hook in the
   first ~210 chars, ~900–1,500 chars, optimize for *saves*, no links in the body). Aim for one
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
     the gate passes trivially. The authenticity/substance bar in `voice/voice-notes.md` covers
     these. Be honest: if the post mixes a real external claim into a personal story, it is *not*
     `external_claims:false`.
   - **Re-verify on edit.** The show→edit→re-show loop below can add a claim after the sidecar was
     written. **Whenever an edit adds or changes an external claim, re-run this step** and update the
     sidecar before publishing.
7. **Show the user the full draft** in chat and ask: *"Publish this to LinkedIn, edit it, or
   scrap it?"* Wait for their answer. Do not publish unprompted.
8. **Optionally offer a visual.** After the text is settled, *offer* (never assume):
   *"Want a diagram or card to go with it? (optional)"* If they decline or don't ask, the post
   stays **text-only** — a strong text post outperforms a weak image, so that's a fine default.
   Only build a visual if it genuinely earns dwell time (a real diagram people study), not as
   decoration. For educational / how-to posts, **offer a multi-slide carousel** — the
   highest-reach native format (1.45× vs 1.18× for a single image). See **Visuals → Carousels**
   and `voice/algorithm.md`.

### Visuals (optional — diagrams & cards)

Only when the user opts in. Requires the diagram dependency (see README; if `render_image.py`
reports Playwright/Chromium is missing, point them at the install step and stop).

**Brand guide (per-user).** Styling + byline live in `assets/diagram.css` — the user's personal
brand guide (gitignored). On first use, if it doesn't exist, copy it from the template:
`cp assets/diagram.css.example assets/diagram.css`, then set their `--byline` (shown at the
bottom of every visual) and tweak the palette. Cards use `<div class="footer brand"></div>` to
pull the byline automatically — don't hardcode it.

- **Pick the form.** A **Mermaid diagram** (`--type mermaid`, a `.mmd` flow/architecture/
  sequence) for structured/technical content; a **designed card** (`--type card`, an `.html`)
  for one punchy idea. Card templates to copy:
  - `assets/card-template.html` — general hero (headline / before-after / stat / quote).
  - `assets/card-template-date.html` — **date/deadline type** (a launch, deprecation, event),
    rendered as a realistic ADMIT-ONE ticket; the date is the hero, keep words minimal so it's
    scannable at a glance.
  - `assets/card-template-ramp.html` — **ramp type** (an accelerating progression); three
    ascending steps, the last highlighted. Bars are illustrative, not to scale — the labeled
    figures must be accurate.
  - `assets/card-template-stem.html` — **STEM type** (STEM / education / outreach posts);
    the warm member of the family — same clean dark base, kept playful by a chunky toy-block
    S T E M motif and a soft four-hue corner glow. Reach for it when the tone is kid-energy /
    inspirational rather than buttoned-up.
  - `assets/card-template-flow.html` — **flow type** (architecture / pipeline / data-flow);
    a clean, linear diagram of color-coded stage chips (a left accent bar marks the layer: green
    `.det` / pink `.tools` / blue `.agent` / grey `.out`), each with a bold title and one muted
    example, connected by simple chevrons and auto-centered to fill the card. **Prefer this over
    a Mermaid diagram for architecture posts** — it matches the brand cards and renders crisp at
    phone size, where a Mermaid `.mmd` tends to come out as a skinny, hard-to-read strip. Keep it
    calm: ~4-5 stages, one example each (show sub-steps inline as `A -> B -> C`, don't nest boxes).
    The byline sits inline in the `.toprow` so a feed crop can't remove it.
  - `assets/card-template-code.html` — **code type** (share a snippet); a macOS-style terminal
    window with bat-style line numbers and theme-colored syntax. Highlight by hand — wrap tokens
    in `<span class="t-kw/t-fn/t-str/t-num/t-com">`, mark the one money line `class="line hot"`,
    and cap the last line with `<span class="caret">`. Keep it to ONE idea: short lines (≤~42
    chars) and ≤~10 rows so it stays legible at phone size.
  - `assets/card-template-claude.html` — **Claude Code session** (the session variant of the
    code type): same terminal window, but a *transcript* — the user's request in a clay band,
    Claude's action bullets, tool names, and `└` result branches — for "here's what I shipped
    with Claude Code" posts. Uses Anthropic's clay accent so it reads as Claude Code at a glance;
    be honest — show a real request and a real outcome.
  - `assets/card-template-carousel.html` — **carousel type** (a multi-slide document). See
    **Carousels** below — this is the highest-reach native format and the right choice for
    educational / how-to / step-by-step posts.
  - `assets/card-template-matrix.html` — **matrix type** (a comparison): a labeled grid that
    compares a few options (columns) across the same attributes (rows). Header cells (`.col-h`)
    carry a column accent (`.green`/`.grey`/`.pink`); value cells are `.v` for a big mono NUMBER
    or `.vt` for a short plain-English phrase; one or more `.switch` rows act as group dividers.
    Keep it to ≤4 columns and ≤7 rows so it stays scannable at phone size; translate any insider
    units into plain words so it reads cold (a stranger won't know what "0.85 of goal" means).
  Card styling lives in `assets/diagram.css` (the brand guide) — use its classes, don't add
  one-off inline CSS. Let the user choose the form if unsure.
- **Author the source** into `images/<slug>.mmd` or `images/<slug>.html`. Keep it to one idea;
  **never invent structure, numbers, or relationships that aren't true** (same authenticity rule
  as `voice/voice-notes.md` — a misleading diagram is worse than none).
- **Render:** `.venv/bin/python scripts/render_image.py --type <mermaid|card> --in images/<slug>.<ext> --out images/<slug>.png`
  — this **auto-opens the PNG in the user's image viewer** so they can actually see it (pass
  `--no-open` only for headless/batch use).
- **Show the user the rendered PNG** and iterate (tweak the source or `assets/diagram.css`) until
  they approve it. Don't claim it looks good without showing the image.
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
- **Length: ~900–1,500 characters** (~150–250 words) is the reach sweet spot. Hard cap 3000
  (the script enforces it).
- **Hashtags: 0–3, specific.** They barely help now and 6+ hurt; default to none unless the
  voice profile says otherwise.

---

## Mode: Publish

Only after the user explicitly approves a specific draft.

1. **Preview the payload** (optional sanity check):
   `python3 scripts/linkedin_post.py --file drafts/<file>.md --dry-run`
2. **Publish:** `python3 scripts/linkedin_post.py --file drafts/<file>.md`
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
