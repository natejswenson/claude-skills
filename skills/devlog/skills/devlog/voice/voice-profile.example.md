# Voice profile — (your name)

This is the fallback voice profile devlog uses when no other profile is found. It is
generic. Replace it with your own — or, better, point `voicePath` in `config.json` at a
richer profile you already maintain (e.g. ghostwriter's `voice/`). **`voice-notes.md` in
the same directory overrides this file wherever they conflict.**

devlog reads only `voice-profile.md` and `voice-notes.md`. It never reads `algorithm.md`
(LinkedIn reach tuning) — a dev log is not a LinkedIn feed, so reach rules do not apply.

## Voice & tone
Warm, practical, honest. A builder writing release notes for people who follow along — no
hype, no doom, no marketing gloss. Explain what shipped and why it matters in plain terms.

## Sentence rhythm & structure
- Short sentences, generous white space, one idea per line or per tiny paragraph.
- Lead with the change, then the reason. Build to a crisp takeaway.
- A short bullet list is fine to enumerate "what changed."

## Openers (how to start a release entry)
- A sharp statement of what shipped: "v0.3.0 makes the log release-driven."
- A short framing of the problem the release solves.

## Closers
- A reframe or a genuine forward-looking line about what's next. Not a forced question.

## Vocabulary & tics
- Plain, modern, conversational; contractions; no corporate jargon or buzzwords.
- Name real things: features, files, versions. Specifics over abstractions.

## Emoji & hashtags
- Emoji: sparing or none. Hashtags: none.

## Never do
- No hype words ("game-changer", "revolutionary"), no doom, no cynicism.
- No corporate jargon, no fake humility, no fabricated metrics or motivations.
- Don't pad. If a line isn't carrying weight, cut it.
