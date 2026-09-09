# Local raster composition schema

Pass a JSON file to `compose-art-cover --spec <file> --out <new-directory>`.
The output directory's parent must exist. Each attempt owns a new directory and
writes its result marker last. The command does not overwrite or delete an existing
attempt, generate artwork, call a service or publish.

```json
{
  "schema": 1,
  "source": "source-v1.png",
  "brand": "brand.json",
  "title": "Give your CLI an import-safe entrypoint",
  "kicker": "ENGINEERING FIELD NOTES",
  "stand": "Reuse the logic. Run only when invoked."
}
```

`source`, `brand` and optional `fontPath` resolve relative to this JSON file. Use a
local static raster, not SVG, animated media, a URL or executable HTML. `title` is
required; `kicker` and `stand` are optional plain text. Text is escaped, measured and
rejected if it cannot fit the owned layout. The source is contained at its original
aspect ratio rather than cropped or stretched.

`brand` is a generated/adopted JSON token export containing `colors` (`paper`, `ink`,
`dim`, `accent`), `fonts` (`display_stack`, `serif_stack`, `mono_stack`) and `identity`
(`stamp`, `name`). Generate it using PRESS `tokens --format json` when available, or
use an existing compatible adopted export. Do not manually copy brand constants.
Optional `fontPath` supplies an adopted local display font; other font stacks remain
host-dependent. Inspect the result's font report rather than assuming a font loaded.

Outputs are `composition.html`, `cover.png` (1600×900 true-color sRGB PNG),
`thumbnail.png` (320×180) and `result.json`. Results include exact paths, hashes,
dimensions, bytes and mechanical findings. Successful composition is not a semantic
or visual review. A PNG without its matching completed result marker is incomplete.

Keep this spec, sources, prompts and receipt in local run storage. Select the exact
reviewed PNG for a reading preview. A separate existing-post backfill must preserve
article metadata, use its authorized replacement path and verify the target site's
actual cover/feed rendering before claiming compatibility.
