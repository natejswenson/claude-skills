# AI artwork for a local cover draft

This path is selected explicitly for an AI cover draft, by Concept guide draft mode,
or for the single guide selected by an opted-in normal concept Generate run.
It never scans releases, publishes, replaces existing cover files or changes branding
configuration. The legacy Generate mode's local SVG/HTML renderer and failure behavior
are unchanged. On Claude, use that existing local workflow for concept-guide covers. For strict
concept publication, expand its palette PNG into a true-color PNG with the bundled
Sharp dependency before final inspection and hashing. This conversion does not restore
any detail already lost during quantization; retain the source and inspect the result.
Do not apply a second palette reduction to a native AI cover.

For Claude's existing palette output only, this local conversion uses the already
bundled dependency and refuses to overwrite the new output path:

```bash
node --input-type=module - '<skill-root>/package.json' '<legacy-cover.png>' '<new-true-color-cover.png>' <<'JS'
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const [packageFile, input, output] = process.argv.slice(2);
const sharp = createRequire(resolve(packageFile))('sharp');
const bytes = await sharp(input).toColourspace('srgb').png({ palette: false }).toBuffer();
await writeFile(output, bytes, { flag: 'wx' });
JS
```

Inspect and hash that final output, not the original palette file. A Git-installed plugin or standalone SKILL.md may have no dependencies beside it.
In that case use the exact-version published package runtime described in SKILL.md;
resolve its actual package/dependency location for this conversion instead of writing
into an internal plugin cache or assuming node_modules exists. If unavailable, retain
the draft and report the missing conversion capability rather than guessing a tool
path. The normal Codex native-art compositor uses the same exact-version helper
fallback when bundled dependencies are absent.

## Capability and brief

In Codex, inspect whether native image generation is actually available. Use the native image-generation tool for new art and native editing for raster changes
when present; no API key or image API client belongs in the Node helper. If
unavailable or failed, save the draft and art brief with the blocker. Do not silently
substitute SVG, claim an image exists, or activate a paid CLI/API fallback. An explicitly
requested fallback follows the available imagegen skill's instructions.

Finish the guide before choosing the visual. Read the reviewed outcome, mechanism,
failure case and exclusions, then make a short public-safe brief. Do not send the entire
guide handoff, private repository files, source logs or private identities to generation.
Inspect the most recent relevant cover if available. A reference guides craft, not a
copied subject; lack of a first reference is not a blocker.

Choose one concrete metaphor whose meaning matches the article. The proven direction
is detailed editorial engraving with controlled hatching and a clean silhouette, quiet
paper surrounding the subject and one small focal accent. Complexity must describe the
mechanism, not decorate it. A beautiful picture implying an unsupported guarantee fails.

Read palette and identity from adopted/generated brand resources, respecting custom
style restrictions. Do not duplicate brand values manually. Prefer an opaque paper
background: the pilot's transparency requests repeatedly returned painted checkerboards.
Use transparency only when needed, and inspect actual alpha plus the rendered composite.

## Generate, persist and compose

Write a prompt specifying subject, mechanism, medium, framing, craft, supplied palette,
and exclusions. Request **artwork only**, with no lettering, labels, numbers, logos or
fake code. Typography is rendered locally. One strong candidate is enough; no mandatory
batch. Use only supported tool arguments, and record only runtime details actually
reported. Do not invent model, seed, quality or destination controls.

After the tool returns, copy that exact returned image to a versioned source path in
the run directory. Never pick the newest file in a shared image folder. Save the prompt,
brief, reference hashes and attributable tool result. Inspect the image before any
native edit; preserve explicit invariants. If bytes cannot be recovered, record that
blocker rather than inventing a file. Retain original sources when revising.

The deterministic compositor is separate from AI generation:

```text
devlog compose-art-cover --spec /absolute/cover-spec.json --out /absolute/new-cover-attempt
```

Use the schema documented in the helper's `cover-spec` reference below. Paths resolve
against the spec file, not the caller's working directory. No agent-authored executable
HTML is accepted. The helper decodes local art, embeds it in an owned layout, renders
escaped typography, preserves aspect ratio, exports a 1600×900 true-color PNG and
320px thumbnail, and writes a result marker last. It blocks browser network requests.
System-font rendering is host-dependent and must be reported; supply an adopted local
font when exact font delivery is required. It never overwrites the source or an existing
attempt directory and never calls an image service or publication code.

## Review and resume

Open the actual source and final cover, both full size and thumbnail. Read every
overlaid word. Check meaning, coherent detail, small-size silhouette, title contrast,
crop, accidental generated text, brand fit and distinction from nearby covers. Show
the final PNG and open the preview for the user. A hash or mechanical success cannot
certify visual meaning, quality or approval. Local preview is not proof of the live
site's feed crop or image loading.

Save `cover-art.json` locally with schema version 1, brief/prompt hashes, source and
reference hashes, selected composition/result, and observed review findings tied to
the exact PNG hash. Do not copy that private receipt into manifests or the reader's
handoff. Measure output bytes; do not apply the legacy palette reducer to detailed art.

Fix typography locally; fix illustration defects with native editing/generation.
Allow at most two targeted correction cycles after the first candidate. A critical
unresolved failure holds the cover and retains the completed guide. Each changed
source/brief needs meaning review; each changed crop/font/title/palette needs final
image review. Unrelated prose edits call for a brief check, not automatic regeneration.

An image without a completed result marker and matching hashes is an incomplete
attempt. Recover from recorded inputs; uncertain generation must not trigger unattended
retries. No cover is promoted merely because its filename is `cover.png`. After a
reviewed result, pass its PNG to `prepare-guide --cover`; the agent handoff stays first.
Explicit draft requests stop here. For an opted-in normal concept Generate run,
continue through guide-publishing.md and its actual consumer checks. Existing-post
backfill remains separately scoped work. Older readers can continue loading the final PNG.

## Cover spec

See [cover-spec.md](cover-spec.md) for the exact schema and generated-brand input.
