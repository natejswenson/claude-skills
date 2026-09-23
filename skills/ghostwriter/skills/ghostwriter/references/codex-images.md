# Codex generated cards

Read this reference only after the user approves the post text and chooses a generated
PRESS card. This is the Codex replacement for filling an HTML card template. It does not
change Claude Code's local renderer or the carousel workflow. Read
`references/visual-review.md` before generating: its recorded review is mandatory
before any candidate is shown or offered for approval.

## The job

Create one original portrait 4:5 card that **supplements** the post. It must add a visual
explanation the body does not already provide: a system map, comparison, sequence, method,
decision, or key number. A decorated restatement of the opening line fails.

Read [visual-composition.md](visual-composition.md) before choosing the hero.
Default to a picture that explains the idea, with supporting type; a large
headline plus a text ledger is not the default generated-card composition.

The finished result is still a card, with PRESS anatomy:

- masthead and square monogram stamp;
- one concise headline at supporting scale;
- one dominant visual hero, such as an editorial illustration, spatial comparison,
  or evidence-backed diagram;
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
the seed's subject, wording, diagram, or layout. Current brand laws override the seed:
inspect it for outdated treatments and explicitly exclude them from the prompt. A seed is
not a pre-approved example and cannot waive a visual-review failure.

The seed library is a repeatability tool, not a template gallery. Before generating, read the
last two lines of `images/generated-card-history.jsonl` when it exists. Change at least two of:
headline treatment, hero type, flow direction, density, numeral role, or support texture.

## Reality gate for architecture and flows

An architecture or flow card is a factual diagram, not a visual metaphor. The approved post is
an anchor, but it is not sufficient evidence for system structure. Before writing image copy or
calling the image tool:

1. Read the implementation sources that define the system: code, manifests, configuration,
   tests, and maintained architecture docs. Prefer executable behavior over prose when they
   disagree. For an external system, use primary documentation and the post's verified sources.
2. Write an evidence model into the prompt receipt with:
   - `evidence`: each structural claim and the file plus symbol/section that proves it;
   - `nodes`: every box/layer the image may show, its meaning, and supporting evidence IDs;
   - `edges`: every arrow or containment relationship, its direction and meaning, and supporting
     evidence IDs;
   - `exceptions`: conditions that branch, stop, or bypass the normal path.
3. Reject any node or edge that has no evidence. Do not infer a data flow from visual proximity,
   turn a validation check into a transformation, or show an exception as the normal outcome.
4. Summarize the verified model in one compact table only when the user needs to choose between
   materially different interpretations. Otherwise keep the evidence bookkeeping private.

For non-architecture cards, use the same principle at the appropriate scale: every number,
comparison, sequence, and causal relationship must trace to the approved draft or its sources.

## Prompt receipt

Before calling the image tool, register the versioned candidate using
`visual_review.py register` and save `images/<slug>-generated-vN.image.json` with:

```json
{
  "generator": "codex-imagegen",
  "post_anchor": "<exact excerpt from the approved post>",
  "visual_claim": "<what the hero explains about that point>",
  "visual_encoding": {
    "marks": "<which pictorial marks carry meaning>",
    "mapping": "<how those marks map to the evidence>",
    "picture_text_balance": "<picture area and supporting labels>"
  },
  "alt_text": "<exact description to publish>",
  "seed": "assets/image-seeds/<file>.png",
  "information_shape": "system-map",
  "brand_source": "~/.claude/ghostwriter/assets/diagram.css",
  "palette": {"paper": "...", "ink": "...", "dim": "...", "accent": "..."},
  "evidence_model": {
    "evidence": [{"id": "E1", "claim": "...", "source": "path", "locator": "symbol or section"}],
    "nodes": [{"id": "N1", "label": "...", "meaning": "...", "evidence": ["E1"]}],
    "edges": [{"from": "N1", "to": "N2", "meaning": "...", "evidence": ["E1"]}],
    "exceptions": [{"condition": "...", "result": "...", "evidence": ["E1"]}]
  },
  "exact_text": ["..."],
  "prompt": "...",
  "checks": []
}
```

This receipt is the reproducible source for edits. Write a new version whenever the prompt or
selected output changes; after preparing review, changing the receipt invalidates that review.
Never rely on the conversation transcript as the only copy of the prompt.

## Generate

1. Reduce the approved post to its real anchor, the reader's save, the information shape, and
   the one visual relationship the card should prove. For architecture/flow, build and verify the
   evidence model above first. Do not add a fact, person, setting, or outcome the draft and its
   evidence did not establish.
2. Compose the visual encoding first, following `visual-composition.md`, then write
   the card's exact copy. Keep it compact: one masthead, one headline of at most two
   short lines, at most five hero labels, and one optional standfirst or colophon. The hero
   must do more than repeat the headline. Describe the encoding in the receipt;
   keep type subordinate to the picture without hiding necessary qualifications.
3. Build a production prompt for an `infographic-diagram`, `productivity-visual` or `ads-marketing` LinkedIn editorial
   card, portrait 4:5. Include the PRESS values read from the brand source, the seed's role,
   the requested composition, every string under `Text (verbatim)`, and explicit avoid rules.
4. Save the prompt receipt, then use Codex's built-in image-generation tool with the selected
   seed as `referenced_image_paths`. Do not use an API-key CLI or silently switch models.
5. Show one lowercase progress line while it runs: `generating the press card…`.

## Mandatory visual review

Follow `references/visual-review.md` for the private independent editor pass and
all 12 checks. Inspect the actual pixels at full resolution and at 360px feed width;
a prompt, matching palette, or source-only check cannot pass a generated image.
That reference preserves the full rendered-graph reconciliation for architecture
and flows and the two-failed-candidate limit. Reconcile every node, arrow,
containment and exception after every edit, even a targeted text correction.

Run `visual_review.py check` on the exact candidate and approved post. Only exit 0
permits the save/open/approve presentation below. If the host cannot keep automatic
image previews private, follow the explicit limitation path before generating.

## Save, open, approve

Copy the selected built-in output from its reported Codex location to
`images/<slug>-generated-vN.png`; never leave a publish-bound asset only under Codex's generated
image directory and never overwrite an existing candidate.

After every generated or edited candidate that passes all applicable checks, open the PNG in a
compatible image viewer (fall back to a browser if the default viewer has no PNG handler) so they
can inspect it full-size. Also show the actual image in the conversation. Opening is required
before asking for approval; if no compatible viewer can open it, state that plainly and provide
the full-resolution artifact link rather than claiming it opened. Use selectable responses when
available only when their purpose permits approval and the complete image stays
visible; otherwise keep the image, alt text and decision in the final message
and wait for a normal reply, as `codex-session-ui.md` describes. Ask one decision:
**Approve card** / **Change card** / **Drop card**. A change is re-inspected, opened, and
re-shown. Approve card selects the media; it does not authorize publication.
Then use `codex-session-ui.md` to show the full final post, image and reviewed alt
text together for the final publication decision. A draft-only request stops at
the approved artifacts. Publishing still requires the approved post text and
the final approved card.

On approval, retain the reviewed versioned path for publication; do not copy or rename it.
Append one line to `images/generated-card-history.jsonl` with the selected path, seed and
variation axes. Keep the bound prompt receipt unchanged. Use its reviewed alt text verbatim;
changing the description requires another review. Use the pre-generation history snapshot
for review evidence so this append does not change a bound input.

If the built-in image tool is unavailable, say so once and offer the deterministic renderer or
text-only. The legacy renderer is never an automatic fallback.
