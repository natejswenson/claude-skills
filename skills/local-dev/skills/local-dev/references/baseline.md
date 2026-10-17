# Baseline provenance and refresh

`evals/real-inspection.json` was captured by `inspect` in the actual local-dev
feature worktree on 2026-09-23 after its reviewed plan commit (`17de0ee`) and
initial implementation. Only `root` was replaced with a portable checkout label.
Branches, commit, changed paths, instructions and plans are observed local state.
No remote URLs, issue content, credentials or personal transcripts are included.
`invalid-inspection.json` changes only the dirty flag to contradict the files.

`evals/baseline/inspection.md` is the actual offline `report` output, frozen by
skillfactory. This baseline proves deterministic inspection-report behavior,
not every model decision or a live end-to-end PR creation. The helper tests use
real temporary Git repositories and CLI doubles to verify command boundaries;
the independent workflow test separately exercises planning through local commits.

To refresh from the inner skill directory, capture a new real inspection to a
scratch file, review its contents, replace only the private machine root with a
portable label, and promote it to `evals/real-inspection.json`. Preserve evidence
of why the refresh is necessary. Derive the bad case by flipping only `dirty`.

```bash
node scripts/local-dev.js inspect --repo /path/to/real/worktree
node scripts/local-dev.js report --input evals/real-inspection.json --out /tmp/local-dev-reviewed-run
node ../../../skillfactory/skills/skillfactory/scripts/skillfactory.js freeze --repo ../../../.. --skill local-dev --from /tmp/local-dev-reviewed-run --label local-dev-inspection --command 'node scripts/local-dev.js report --input evals/real-inspection.json --out "$OUT"' --trap-command 'node scripts/local-dev.js report --input evals/invalid-inspection.json'
npm test
```

Use a fresh output path: the reporter refuses to replace an existing report.
Inspect both the fixture and golden diff; never refresh solely to silence a test.
