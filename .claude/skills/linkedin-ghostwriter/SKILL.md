---
name: linkedin-ghostwriter
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

1. **Get the topic.** Resolve in this order:
   - The user named a topic → use it.
   - **"From the radar" / references a release** ("draft a post from item 2 in the radar") →
     read the newest `research/release-radar-*.md` digest, take that item's facts + suggested
     angle, and draft it. The radar is produced by the twice-weekly research job
     (`scripts/release_radar.sh`), so the facts are pre-sourced — but still apply the voice rules
     below and never add experience claims the digest didn't establish. If no digest exists yet,
     fall back to the "Trending" path.
   - "Trending" / "something in my field" / "what's new" → read `voice/interests.md`, then use
     web search to find 2–4 recent, genuinely noteworthy developments in those areas. Pick the
     one with the strongest personal angle. Briefly tell the user which you picked and why.
   - "From my interests" / no topic given → pick an evergreen theme from `voice/interests.md`
     they haven't covered recently.
2. **Draft against the voice profile.** Read `voice/voice-notes.md` AND `voice/voice-profile.md`
   first, every time (voice-notes.md holds direct user feedback and takes priority). If either
   is missing — e.g. a fresh setup — copy `voice/voice-notes.example.md` to
   `voice/voice-notes.md` and proceed with what you have (`voice/interests.md` plus the
   defaults). Write the
   post to match them — their openers, rhythm, formatting, emoji/hashtag habits. Apply the
   **Engagement craft** rules below. Aim for one strong post, not three mediocre options.
   **Never fabricate or exaggerate** details that aren't true to the user's real experience —
   authenticity over drama (see voice-notes.md).
3. **Save the draft** to `drafts/` as `YYYY-MM-DD-slug.md` (ask the user for today's date if you
   don't have it; do not invent one).
4. **Show the user the full draft** in chat and ask: *"Publish this to LinkedIn, edit it, or
   scrap it?"* Wait for their answer. Do not publish unprompted.
5. **Optionally offer a visual.** After the text is settled, *offer* (never assume):
   *"Want a diagram or card to go with it? (optional)"* If they decline or don't ask, the post
   stays **text-only** — that's the default. Only build a visual if they opt in. See **Visuals**.

### Visuals (optional — diagrams & cards)

Only when the user opts in. Requires the diagram dependency (see README; if `render_image.py`
reports Playwright/Chromium is missing, point them at the install step and stop).

- **Pick the form.** A **Mermaid diagram** (`--type mermaid`, a `.mmd` flow/architecture/
  sequence) for structured/technical content; a **designed card** (`--type card`, an `.html`
  copied from `assets/card-template.html`) for one punchy idea (headline / before-after / stat).
  Let the user choose if unsure.
- **Author the source** into `images/<slug>.mmd` or `images/<slug>.html`. Keep it to one idea;
  **never invent structure, numbers, or relationships that aren't true** (same authenticity rule
  as `voice/voice-notes.md` — a misleading diagram is worse than none).
- **Render:** `.venv/bin/python scripts/render_image.py --type <mermaid|card> --in images/<slug>.<ext> --out images/<slug>.png`
- **Show the user the rendered PNG** and iterate (tweak the source or `assets/diagram.css`) until
  they approve it. Don't claim it looks good without showing the image.
- **Write alt text** describing the visual; you'll pass it to the publish step.

### Engagement craft (apply to every draft)

- **Hook in line one.** It must earn the "see more" click — a sharp claim, a specific number,
  a tension, or a story cold-open. No throat-clearing ("I've been thinking lately...").
- **One idea per post.** Cut anything that isn't serving the single point.
- **Specifics over abstractions.** Real numbers, real moments, real names of things.
- **Short lines, white space.** LinkedIn is read on phones. Generous line breaks.
- **Earn the ending.** End with a genuine question or a line worth re-sharing, if that matches
  their voice — never a hollow "Thoughts? 👇" unless they actually write that way.
- **Sound human.** No "In today's fast-paced world", no "game-changer", no "delve", no
  manufactured humility. If it reads like AI, rewrite it. Match the profile's "Never do" list.
- **Length:** typically 80–250 words. Hard cap 3000 characters (the script enforces it).
- **Hashtags:** only if the voice profile says they use them; 3–5 max, at the end.

---

## Mode: Publish

Only after the user explicitly approves a specific draft.

1. **Preview the payload** (optional sanity check):
   `python3 scripts/linkedin_post.py --file drafts/<file>.md --dry-run`
2. **Publish:** `python3 scripts/linkedin_post.py --file drafts/<file>.md`
   - **With an approved visual** (only if the user opted in and approved the PNG), add
     `--image images/<slug>.png --alt "<alt text>"`. Never attach an image the user hasn't seen
     and approved; if the image changes, re-show and re-confirm.
3. **Report** the result. On success, share the post URL the script prints. On an auth error
   (HTTP 401/403), tell the user to re-run `python3 scripts/linkedin_auth.py` (token likely
   expired after ~60 days), then retry.

Never run the non-`--dry-run` publish command without a clear, specific approval from the user
for that exact draft.

---

## Guardrails

- **Never publish without explicit approval** of the specific text. Editing the draft → re-show
  → re-confirm.
- **Never print or commit secrets.** `.env`, `data/`, and `drafts/` are gitignored; keep it that
  way. Don't echo the access token or client secret in chat.
- **Don't fabricate facts** in posts — no invented metrics, quotes, or events. If a trending
  claim needs a number, verify it via web search or leave it out.
- **One post per request** unless the user asks for several.
- **Compliance (LinkedIn API ToS §3.1) — never automate posting.** Every post must be
  member-initiated and explicitly approved by the user, one at a time. Do NOT set up scheduled,
  looped, cron, or unattended posting; do NOT scrape LinkedIn for voice data or topics (use the
  official data export only). Removing the human approval step would violate the terms. See
  `COMPLIANCE.md`. If the user asks for autonomous auto-posting, decline and explain this.
