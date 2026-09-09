# Guide preview fixtures

`import-safe-cli.md` is the complete September 9, 2026 ESM consolidation pilot,
copied from `docs/pilots/2026-09-09-esm-cli/v0.5.1.md`. Its observed implementation
and agent trial results belong to that pilot's evidence, not to this preview test.
The test checks structural lint and faithful, safe copying/rendering only; it does
not execute or revalidate the guide's example.

Frozen article SHA-256: `e56d2a34ba579e7372bdbb09dfc37aa8faf3a408fdd5c9d0ae5b98e5f688e590`.

`press-tokens.json` was generated with the repository PRESS token exporter on
September 9, 2026. It is a frozen test input, not a production branding fallback.
Production preview callers supply an explicit freshly generated token JSON file.
Generation command (repository PRESS 0.9.0):

```sh
node skills/press/skills/press/bin/press.js tokens --format json
```
