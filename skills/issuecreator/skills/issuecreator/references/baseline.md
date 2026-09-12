# Refreshing the baseline

The frozen draft comes from the user's real request to add issuecreator, researched
against the working tree on 2026-09-12. It was rendered locally, inspected and then
frozen. No issue was published. The remote publication tests use offline doubles;
they do not prove live GitHub publication.

From this skill directory, render a new run:

```bash
node scripts/issuecreator.js render --input evals/real-draft.json --out /tmp/issuecreator-refresh
```

Inspect the output and explain intentional differences. From the monorepo root:

```bash
node skills/skillfactory/skills/skillfactory/scripts/skillfactory.js freeze --skill issuecreator --from /tmp/issuecreator-refresh --command 'node scripts/issuecreator.js render --input evals/real-draft.json --out "$OUT"' --trap-command 'node scripts/issuecreator.js validate --input evals/incomplete-draft.json'
```

Run `npm test` in the skill directory. The baseline reproduces and byte-compares
both output artifacts and rejects the captured draft with acceptance criteria
removed. Publication tests separately exercise uncertain creation and wrong remote
content; keep their invariant declaration pointing to `scripts/tests/issuecreator.test.mjs`.
