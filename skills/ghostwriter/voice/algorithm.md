# LinkedIn reach optimization (apply to every post)

Evidence-based, current as of 2026. Sources: Richard van der Blom *Algorithm InSights*
(1.8M-post study), Sprout Social, AuthoredUp, Hootsuite. LinkedIn moved from a
network-based to an **interest-based** ranking; platform-wide impressions fell ~63–66%
since 2023, so reach now comes from quality signals + early engagement, not just who you
know. **These rules must never override `voice-notes.md`** — where they conflict (e.g. CTA
questions), voice-notes wins, and the resolution is noted below.

## How distribution works (why the first hour decides everything)
1. **Quality filter** on publish (spam / low-quality screened out).
2. **Tested on a small slice** of your network. The first **30–60 minutes** ("golden hour")
   of engagement set the trajectory.
3. Strong early signals → expansion to 2nd/3rd-degree and interest-matched feeds.
A dead first hour is a dead post.

## Engagement signals by weight — optimize for the top
- **Save ≈ 5× a like (~2× a comment). Saves are the #1 lever.** Make posts
  reference-worthy: a framework, a checklist, a "how to", a reusable mental model people
  want to keep.
- **Comment** (especially replies-to-replies / real discussion) ≈ 2×+ a like.
- Repost, then like (baseline).
- **For Nate: engineer for SAVES and genuine discussion, never for CTA bait.** This is how
  we chase the algorithm *without* violating voice-notes' "no reflexive closing question".

## Bake into every draft
- **Hook in the first ~210 characters / first 2–3 lines** — that is all that shows before
  "…see more". The most specific or provocative line goes first. No throat-clearing.
- **Knowledge / advice content gets ~3–5× reach.** Teach one thing the reader can apply
  (prescriptive, for the reader — see voice-notes).
- **Length ~900–1,500 characters** (top posts ~1,300; 900–1,000 is the safe sweet spot).
  Short paragraphs (≤3–4 lines), generous white space, ~8th-grade reading level (above
  10th grade ≈ 35% less reach).
- **No external links in the post body** — a single in-body link cuts reach ~50–70%. Put
  the link in the **first comment** and reference it in the copy ("link in comments").
- **Hashtags: 0–3, specific.** They barely move reach now and 6+ actively hurt. Nate's
  default of none is fine.
- **End on substance** — a line worth re-sharing, or a genuine question only when it truly
  is the strongest ending. Never a reflexive "Thoughts? 👇".

## Format, ranked by reach (the biggest structural lever)
Personal-profile reach multipliers (van der Blom): **Poll 1.64× · Document/carousel 1.45×
· Image 1.18× · Video 1.10× · Text 0.88×.**
- **For educational / how-to / architecture posts, a multi-slide DOCUMENT (PDF carousel)
  is the strongest native format** — it maximizes dwell time and saves. Prefer it over a
  single decorative image. The skill supports carousels end-to-end: build slides from
  `assets/card-template-carousel.html`, render with `scripts/render_carousel.py`, and post
  with `linkedin_post.py --document <pdf> --title "..."` (see SKILL.md → Carousels).
- A **single image only helps when it genuinely adds** — a real diagram people study (like
  the architecture flow card), not decoration. A decorative card is the weakest visual.
- **Text-only with a strong hook is fine** and beats a weak image for dwell and saves.
- Short, captioned native **video** is rising; **external-link** posts are throttled.

## Posting behavior (Nate's actions — the skill can't do these, so prompt for them)
- **Cadence: 3–5×/week, consistent.** Max ~1/day. Don't delete-and-repost (it resets
  distribution).
- **Post when your audience is active** (use your own analytics; generally weekday mornings
  to early afternoon, Tue–Thu).
- **Golden hour:** for 60 minutes after posting, **reply to every comment** and go
  **comment on 5+ other people's posts**. Early velocity plus your own activity signal is
  most of the battle.
- **Reply with substance** (a question back, not just "thanks") to drive nested replies
  (~2.4× reach).

## Honest caveat
Content optimization raises the ceiling; it can't manufacture an audience. Low reach on a
small or young network is mostly fixed by **consistency, first-hour engagement, and
broadening the hook** beyond deep niche jargon — not by any single-post tweak.
