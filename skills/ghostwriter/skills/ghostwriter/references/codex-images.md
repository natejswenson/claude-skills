# Codex generated cards

Read this reference only after the user approves the post text and chooses a generated
PRESS card. This is the Codex replacement for filling an HTML card template. It does not
change Claude Code's local renderer or the carousel workflow.

## The job

Create one original portrait 4:5 card that **supplements** the post. It must add a visual
explanation the body does not already provide: a system map, comparison, sequence, method,
decision, or key number. A decorated restatement of the opening line fails.

The finished result is still a card, with PRESS anatomy:

- masthead and square monogram stamp;
- one dominant headline;
- one proof-bearing hero, such as a diagram, ledger, duel, or big figure;
- a small standfirst or marginal note only when it adds meaning;
- ruled colophon.

The image model composes those parts for this post instead of filling a fixed skeleton.

## Brand source

Read `~/.claude/ghostwriter/assets/diagram.css`. If it is missing, copy
`assets/diagram.css.example` there first. Extract the paper, ink, signature accent, identity,
and type roles from `.card.press`; never type brand values from memory or invent local colors.

Translate the source into these laws:

- warm paper, near-black ink, and one signature accent used once or twice;
- heavy ink rules and whitespace carry structure;
- display sans carries headlines, serif italic carries commentary, mono carries data;
- no gradients, glass, shadows, rounded panels, traffic-light colors, neon, glossy 3D,
  stock-photo staging, generic robots, glowing brains, or floating AI glyphs;
- no logos, watermarks, fake terminal output, decorative code, or unsupported facts.

## Seed library

Read `assets/image-seeds/manifest.json` and choose the seed whose **information shape** best
matches the post. Pass that PNG to the built-in image tool as a style reference. State that
the seed controls palette, print texture, typography, and PRESS anatomy only; it must not copy
the seed's subject, wording, diagram, or layout.

The seed library is a repeatability tool, not a template gallery. Before generating, read the
last two lines of `images/generated-card-history.jsonl` when it exists. Change at least two of:
headline treatment, hero type, flow direction, density, numeral role, or support texture.

## Prompt receipt

Before calling the image tool, save `images/<slug>.image.json` with:

```json
{
  "seed": "assets/image-seeds/<file>.png",
  "information_shape": "system-map",
  "brand_source": "~/.claude/ghostwriter/assets/diagram.css",
  "palette": {"paper": "...", "ink": "...", "dim": "...", "accent": "..."},
  "exact_text": ["..."],
  "prompt": "...",
  "checks": []
}
```

This receipt is the reproducible source for edits. Update it whenever the prompt or selected
output changes. Never rely on the conversation transcript as the only copy of the prompt.

## Generate

1. Reduce the approved post to its real anchor, the reader's save, the information shape, and
   the one visual relationship the card should prove. Do not add a fact, person, setting, or
   outcome the draft did not establish.
2. Write the card's exact copy. Keep it compact: one masthead, one headline of at most two
   short lines, at most five hero labels, and one optional standfirst or colophon. The hero
   must do more than repeat the headline.
3. Build a production prompt for a `productivity-visual` or `ads-marketing` LinkedIn editorial
   card, portrait 4:5. Include the PRESS values read from the brand source, the seed's role,
   the requested composition, every string under `Text (verbatim)`, and explicit avoid rules.
4. Save the prompt receipt, then use Codex's built-in image-generation tool with the selected
   seed as `referenced_image_paths`. Do not use an API-key CLI or silently switch models.
5. Show one lowercase progress line while it runs: `generating the press card…`.

## Text fidelity and art direction

Read every rendered word at full resolution. A card fails for any misspelling, substitution,
duplicate, omitted string, invented microcopy, or clipped text. Fix only that defect with a
targeted image edit when the composition is otherwise sound. Never approve "close enough"
typography on a professional post.

Then check the card like an art director:

- the hero visibly explains the post's anchor;
- the card is portrait 4:5 and remains readable at feed size;
- paper, ink, and one accent dominate;
- the headline has one clear reading order and no widow word;
- the seed's layout was not copied;
- no fake code, terminal, UI, logo, watermark, or unsupported relationship slipped in;
- it looks like a complete LinkedIn information card, not a standalone abstract illustration.

Fix one defect at a time, re-open, and inspect again. After two failed internal attempts, stop
and offer the deterministic renderer or text-only rather than making the user watch an
open-ended generation loop.

## Save, open, approve

Copy the selected built-in output from its reported Codex location to
`images/<slug>-generated-vN.png`; never leave a publish-bound asset only under Codex's generated
image directory and never overwrite an existing candidate.

After every generated or edited candidate, open the PNG in the user's image viewer so they can
inspect it full-size. Also show the actual image in the conversation. Ask one decision:
**Approve card** / **Change card** / **Drop card**. A change is re-inspected, opened, and
re-shown. Publishing still requires the approved post text and the final approved card.

On approval, copy the selected file to `images/<slug>.png`, add the prompt receipt's completed
checks and selected path, and append one line to `images/generated-card-history.jsonl` with the
seed and variation axes. Write alt text that describes the hierarchy and diagram without
repeating every word on the card.

If the built-in image tool is unavailable, say so once and offer the deterministic renderer or
text-only. The legacy renderer is never an automatic fallback.
