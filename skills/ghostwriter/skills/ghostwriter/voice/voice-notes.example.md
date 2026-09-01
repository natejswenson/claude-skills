# Voice notes (manual feedback)

Rules captured directly from your feedback on drafts. These take priority and
are applied to every post, ahead of the generated `voice-profile.md`.

Copy this file to `voice/voice-notes.md` and edit it as you give feedback —
`voice-notes.md` is gitignored because it's your personal data. The defaults
below are good starting points for anyone; replace or extend them with your own.

## Authenticity
- **Never fabricate or exaggerate.** Don't invent details that didn't happen. If
  a detail isn't true to your actual experience, cut it or ask.
- **No drama-for-effect.** Authenticity beats a punchy-but-false image.

## Tightness
- **Cut fluff and filler.** No padding. Tighter is better.

## Framing & audience
- **Write for the reader, not about yourself.** Prefer prescriptive ("what you
  should do") over autobiographical ("here's what I'm doing").
- **Get to the point fast.** Lead with the thesis; cut any runway before it.

## Register: warm and human by default
- **Sound like yourself talking to a peer, not like a report.** Open on the situation
  or the human reason the thing exists, not a statistic. Name the real thing in plain
  words instead of a category. Narrate in first person as something that happened to
  you. Everyday words over clinical ones; mild self-deprecation is fine when it's true.
- **Warmth outranks maximal tightness.** Spending 30–60 extra words to sound human is
  allowed; padding is not. A draft that avoids every banned tic but reads like an
  incident report still fails.

## The hard bans (what `scripts/ai_tells.py` enforces)
Every draft runs through the AI-fingerprint gate before you see it and before it publishes.
These are the mechanical tells it refuses; the judgment calls (register, "would this sit in
my feed") stay with the model and the cost-capped LLM judge.
- **No em dashes.** A comma, a semicolon, or a colon before a payoff.
- **No "No X. No Y. No Z." fragment lists** and no punchy one-liners added for rhythm.
- **The ending is the #1 AI tell.** Stop on the last real point. No "it's not X, it's Y"
  reframe, no inverted-parallel aphorism, no reflexive "Thoughts?" / "What's your…?" closer.
  A genuine question you want answered is fine; the gate warns so you have to mean it.
- **No strawman opener** ("I keep seeing people…"), no "here's the thing".
- **No slop words** (delve, game-changer, "in today's fast-paced world", "I'm humbled",
  seamless, leverage, "let that sink in") and **no credential flexing** ("16 years of…").
- **No emoji bullets, no hashtag piles** (0–3 hashtags), **no 60-word paragraphs**;
  feed-native means one idea per line, blank line between, ~40 words a block at most.
- **Hedge and filler words** (honestly, actually, truly, "try to", "might be") are warned,
  not blocked; cut them unless the sentence needs one.

## Tone
- <Set your tone — e.g. positive and supportive; argue the idea, never trash a
  person, team, or tool.>
