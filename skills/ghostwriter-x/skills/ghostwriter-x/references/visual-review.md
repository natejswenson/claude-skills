# Review Codex-generated graphics before presentation

This gate applies only to graphics generated or edited with **Codex's built-in
imagegen**. Native screenshots, user-supplied photographs, Claude renders and the
explicit legacy renderer keep their existing workflows. X uses this gate if a
Codex-generated card is attached; this does not change X's default renderer.

An image must earn its place beside the exact post. A beautiful unrelated image
fails. An accurate but dull, cluttered or generic card also fails. Every dimension
below must pass; no average score, mock judge, waived defect or user approval can
substitute for the review. Review passing permits presentation, not publication.

## Before generation

Read the approved post, its current text review, sources, current voice notes,
personal brand CSS, and PRESS `brand/laws.md` and `brand/components.md`. Read the
selected reference, if any, and last two generated-card history entries when available. Use
the generation host's actual tools and image-inspection capabilities.

Register each versioned candidate **before calling imagegen**:

```sh
python3 scripts/visual_review.py register --file drafts/<slug>.md \
  --image images/<slug>-generated-v1.png
```

Save the prompt receipt at `images/<slug>-generated-v1.image.json`. In addition to
the seed, prompt, exact copy and evidence model (LinkedIn: `codex-images.md`), it must have:

- `generator`: `codex-imagegen`;
- `post_anchor`: an exact excerpt from the approved post;
- `visual_claim`: what the hero makes understandable and why this post needs it;
- `export`: `min_width` and `min_height`, integers no lower than 1200 and 1500.
  Use any higher native size the user explicitly requires; the actual PNG must meet it;
- `quality_brief`: nonempty `finish`, `focal_idea` and `reference_basis`. Describe
  the intended visual craft and current user preferences, not just palette and subject.
  Name an actual user-approved reference when available; otherwise identify the brand
  sources and disclose that no approved reference exists. Checker-passed or rejected
  candidates never become approved references automatically;
- `alt_text`: the exact image description intended for publication;
- for X, `tweet_index`: the 1-based tweet containing that anchor. Review the card
  beside that tweet as well as the whole thread; moving it invalidates the match.

For X, the same receipt carries `seed` (null when no suitable reference exists), `information_shape`, `prompt`, `exact_text`
(an array of every intended visible string), and `evidence_model` (claims with
source paths/locators and all diagram nodes, edges and exceptions). Use the
actual X brand/style reference; do not invent a missing seed library.

Every visible element needs a job in that explanation. Design one compelling
focal point, purposeful scale and negative space, and a clear reading path. Plan
an original composition inside PRESS, not a template with new nouns. Do not add
dramatic lighting, ornament, tiny fake labels or excessive accent to simulate
quality. Visual copy follows the user's current voice and the text rubric too.

Keep generated candidates private until the final gate passes: no preview,
viewer auto-open, comparison sheet or approval picker containing rejected art.
Use a private generation/review surface only if the host actually supports it.
Some image tools automatically expose previews; if the host cannot withhold those
previews, explain that limitation before generating and stop this workflow rather
than promising a private gate it cannot provide. A tool preview is never approval.

## Inspect the pixels, then review

Copy the tool's actual output to the registered candidate path without overwriting
an earlier version. No placeholder image, reconstructed diagram, or prompt-only
assessment counts. Prepare a fresh review for every generated or edited candidate:

```sh
python3 scripts/visual_review.py prepare --file drafts/<slug>.md \
  --image images/<slug>-generated-v1.png \
  --receipt images/<slug>-generated-v1.image.json \
  --brand ~/.claude/ghostwriter/assets/diagram.css \
  --brand <press>/brand/laws.md --brand <press>/brand/components.md \
  --evidence <implementation-or-saved-primary-source> \
  --evidence <current-voice-notes> --evidence <selected-seed.png>
```

Omit the seed argument when none was selected. Bind any approved craft reference
and the user feedback used in the quality brief as evidence instead. Inspect only
the original native output; prompt dimensions, preview dimensions and upscaling
cannot establish adequate export quality.

For X use its own personal brand and voice paths. Include every source used to
judge the visual's extra claims, not only the post's source sidecar; save external
source excerpts with their URL and locator locally. Save a snapshot of the pre-generation history alongside the receipt and bind that
snapshot as evidence when history exists. Keep the live history outside the
snapshots so recording approval does not invalidate the review. Do not modify a receipt after preparing its review.

Use **one fresh visual editor subagent** when visual inspection and delegation are
available. Give it the exact image, approved post, rubric, receipt, brand sources,
current voice, selected reference if any, recent cards and claim evidence, without the creator's defense
or prior scores. The editor must open the actual pixels at full resolution and at
approximately **360 CSS pixels wide**, without zooming the feed view to read it.
If delegation is unavailable, perform a separate in-session pass and label it
honestly. If actual image inspection is unavailable, the review stays blocked.

**Make the craft judgment first.** Before checking labels and counts, compare the
image with the quality brief and the available approved reference or brand sources.
Record what makes it visually appealing, its weakest visible element, and whether
that weakness needs another revision. Inspect edge sharpness and type spacing at
100%; in the feed view assess the whole composition without zoom. A correct but
generic block grid, distressed surface, or oversized condensed headline does not
earn a pass merely by using brand colors. Simplicity is welcome when the execution
is refined. Do not award a pass for being better than a failed previous version.

The editor writes `images/<candidate>.visual-review.json`, preserving snapshots:

- `reviewer`: `independent-visual-editor` or truthful `session-visual-editor`;
- `inspection.full_resolution` and `inspection.feed_360px`: concrete observations
  from both views, including reading order, legibility and defects;
- `inspection.craft`: the reference comparison, strongest and weakest visible
  elements, and the resulting revision decision. If a weakness warrants revision,
  fail the applicable rubric row; this observation cannot waive it;
- `revision_required`: the editor's explicit boolean decision, `true` when craft
  needs revision and `false` only when ready to present. Undecided or required
  revision blocks presentation even if all 12 rows were marked pass;
- `observed_text`: every visible string transcribed from pixels, including stamp,
  footer and microcopy. Match receipt string grouping; ignore only whitespace.
  Never copy the prompt into this field as a substitute for reading the image;
- each `checks` row: `status` (`pass`/`fail`), `region` (locatable image area), and
  `reason` (what was observed and the evidence supporting that judgment).

### Every dimension must pass

| Check | Pass only when |
| --- | --- |
| `post_alignment` | The dominant subject and relationship express the post's specific point, audience and scope. Name the anchor excerpt and map the hero to it. Apply the swap test: the same graphic could not accompany an unrelated AI/productivity post with a title change. |
| `visual_substance` | The hero adds an explanation, comparison or useful recognition beyond repeating the headline. Every major mark carries meaning; decoration is not evidence. |
| `brand_fidelity` | Compare the actual pixels with the current personal CSS and PRESS laws: paper/ink, restrained signature accent, type roles, stamp/identity, rules and whitespace. No gradients, shadows, rounded panels, neon or unapproved colors. Identify the accent uses and typography in the reason. Do not claim exact font or color compliance from a prompt or CSS lint alone. |
| `composition` | The image has a striking, intentional focal idea, confident scale, balanced visual weight and purposeful negative space. It looks professionally art-directed at a glance and holds up on inspection. An empty template, generic block grid, dense box diagram, stock illustration or merely correct layout is insufficient. Explain what gives this particular composition visual impact against the quality brief and reference basis; factual accuracy cannot compensate for weak craft. |
| `hierarchy` | Eye movement is immediate: hero or headline first, then its counterpart and supporting detail, according to the composition brief. One dominant message, no competing heroes, arbitrary ornament, awkward gaps, tangencies or cramped margins. The hero earns the space; supporting type must not overpower it by habit. |
| `typography` | Sharp letter edges at 100%, professional spacing, baselines, wrapping and type roles; no stretched glyphs, broken letters, collisions, widow words or tiny filler. Compare with the current brand's type roles, not an outdated seed's condensed headline. Print texture never compromises the copy. |
| `text_fidelity` | Every rendered string is correct, complete, sourced where factual and in the user's voice. No invented microcopy, duplicated labels, hype, slogan, promotional footer or generic AI phrasing. The complete pixel transcription matches `exact_text`, including repeated strings. |
| `credibility` | Every number, scale, arrow, grouping, comparison and implied cause has source support. For graphs, independently transcribe ALL nodes, directions, containment and exceptions in this row's evidence and reconcile the entire rendered graph with the receipt's evidence model. A reversed or ambiguous arrow fails even if every label is spelled correctly. |
| `artifacts` | No malformed icons, pseudo-text, accidental marks, impossible geometry, inconsistent linework, fake terminals/UI, unapproved logos/watermarks or stock AI imagery. Inspect small details at full resolution; stylistic polish cannot excuse artifacts. |
| `originality` | Composition belongs to this post. An optional reference supplies style, never copied wording, subject or skeleton. Compare recent actual cards and name at least two changed variation axes; if history is unavailable, disclose that and compare with the selected reference when one exists, otherwise the composition brief. No invented comparison. |
| `feed_readability` | At 360px wide the headline, hero and all necessary labels are readable without zoom. No clipping, edge risk, muddy contrast, dense microcopy or detail that disappears. Native export is portrait 4:5 (within 1% aspect tolerance), at least 1200×1500 and no smaller than the receipt's declared export minimum. A 1122×1402 image fails: aspect tolerance cannot waive dimensions. Do not upscale a weak candidate to satisfy the header check. Full-resolution sharpness and feed legibility must both pass. |
| `accessibility` | Meaning survives grayscale; direction, categories and status are labelled without color-only cues. Contrast is comfortable at feed size. Alt text accurately describes the important relationship, including exceptions, without adding claims or repeating the entire post. |

No row is `N/A`: a non-diagram still has factual implications, and a short card
still needs meaningful alt text. Explain the applicable evidence rather than
inventing a chart or adding text to satisfy the rubric. Automated PNG/header,
snapshot and transcription checks support this review; they cannot judge beauty,
detect AI authorship, decode every image defect or prove an editor actually looked.

## Revise privately, then present

Fix the reason for rejection, not just its most obvious symptom. After **every**
edit inspect the entire image again and complete a freshly prepared review for all
12 dimensions. Keep the existing **two failed internal candidates** limit; stop
without showing failed art and offer text-only or an explicitly selected alternative.
Only an explicit request for another imagegen attempt authorizes one additional
candidate. Never lower the bar to use the last available image.

```sh
python3 scripts/visual_review.py check --file drafts/<slug>.md \
  --image images/<slug>-generated-v1.png
```

Only exit 0 permits showing/opening that exact image for approval. The command
rechecks sources and all bound inputs after source checks; it never displays an
image itself. Show the passed image and say `Visual review passed`. Follow the
existing card approval flow. Keep the review report and rejected versions local.

Publish the approved versioned path directly. Do not copy/rename the file after
review; a different path or changed pixels, post, alt text, receipt, text review,
brand or evidence requires fresh review and approval. Append history only after
approval; record the approved path and variation axes there, not by changing the
bound receipt. Passing visual review is never permission to publish.

Both publishers check registered Codex assets before dry-run output, media upload
and external draft creation, and repeat the check after their source checks.
There is no review-bypass flag. `.visuals.json` retains candidate origins so deleting
a review file or renaming an attachment does not silently classify it as legacy.
Keep it with the draft. Retained `.image.json`/`.visual-review.json` sidecars also
trigger the gate, including older generated cards that now need a review.

For a genuinely native or legacy attachment alongside generated candidates,
register its distinct path with `--origin native` or `--origin legacy`. Never
relabel generated media, delete provenance, copy away sidecars or convert to PDF
to bypass review. This is a local review contract, not forensic origin detection:
removing every declaration cannot be detected from arbitrary image pixels.
