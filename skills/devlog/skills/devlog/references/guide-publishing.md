# Publishing one concept guide

`generationMode` is optional. Its absence and `"release"` retain the existing
release workflow, config shape and `publish-entry` behavior. Opt in with
`devlog set generationMode concept`; return with `devlog set generationMode release`.
The example config explicitly retains release mode. This setting selects the
agent workflow; it does not turn the legacy publisher into an evidence gate.

In concept mode, inspect the scan's genuine, eligible new final releases, then
choose at most one useful transferable outcome and one release anchor. Draft a
complete guide for the reader's project, with its exact copyable handoff first.
Do not manufacture a version/date to create a publishing slot. Verify that the
selected project/version/date matches the actual release before recording it.
If no candidate can meet the guide quality bar, publish zero guides and explain
what evidence or implementation is missing. The helper does not independently
verify Git tags and does not create a durable suppression ledger for other
candidates. A later scan can still return them.

Run structural lint, reproduce the guide, conduct an independent adaptation
trial in a disposable original project, and independently check the result.
Record observed commands/output and reviewer findings locally. For cover art,
open the full image and thumbnail and record semantic and visual observations
about the final PNG bytes. Fix blocking findings, regenerate the copy payload
and rerun affected checks after edits. Prepare these concrete artifacts before
publication; booleans asserting completion are insufficient.


## Complete a normal concept Generate run

First read [concept-guides.md](concept-guides.md) for the complete draft, handoff,
execution and independent adaptation contract. On Codex also read
[codex-cover-art.md](codex-cover-art.md): generate the reviewed cover with the
available native image-generation tool and locally compose its typography. Do not
substitute the legacy SVG workflow on Codex just to finish. On Claude, follow the
existing local cover workflow and the true-color conversion note in that reference.
A missing required agent, execution or art capability leaves a local draft with a
specific blocker; it does not authorize bypassing the evidence gate. Do not adopt
legacy Generate's optional-cover fallback for a requested concept cover.

Use the CLI bundled relative to the loaded SKILL.md. The commands below show that
form. If the installation is standalone, use the exact version fallback specified
in SKILL.md in place of `node '<skill-root>/bin/devlog.js'`. Replace every placeholder
with recorded paths or validated config values and quote each shell argument.

```bash
node '<skill-root>/bin/devlog.js' scan --json --summary
node '<skill-root>/bin/devlog.js' scan --json --project '<selected-project>'
node '<skill-root>/bin/devlog.js' lint-guide '<article-path>' --voice
node '<skill-root>/bin/devlog.js' prepare-guide --article '<article-path>' --brand '<brand-json>' --out '<new-preview-directory>'
```

Honor an explicit project filter when scanning. Display the selected single
outcome and genuine project/version/date anchor, including any decision to create
zero guides. Follow Generate's voice, research, private-source and truthful
Shipped/Changelog rules; other releases are evidence candidates, not additional
articles to write. Prepare the guide, actually run its examples and the fresh
agent adaptation, independently check the result, and inspect the rendered preview.
Store the reports described below against the final article and exact copied
payload. An article edit invalidates hash-bound reports; rerun affected work and
explain the scope of evidence you retain.

Generate, persist, compose and inspect cover art using codex-cover-art.md. Then
prepare a new final preview (these helpers refuse existing output directories):

```bash
node '<skill-root>/bin/devlog.js' prepare-guide --article '<article-path>' --brand '<brand-json>' --cover '<reviewed-cover.png>' --out '<new-final-preview-directory>'
```

Open that preview and the full cover/thumbnail for the user. Confirm the copy
payload still matches the tested bytes. Hash final artifacts and write the execution,
adaptation and review reports plus `evidence.json`; these records stay in scratch,
outside the content repository. They must describe performed work, not planned work.

Clone the configured target branch into a new recorded scratch directory. The
clone root and content root are distinct when `targetDir` is set:

```bash
mktemp -d
# Record that absolute directory as <run-root> before continuing.
git clone --depth=1 --branch '<branch>' 'https://github.com/<targetRepo>.git' '<run-root>/site'
```

Record the clone, selected anchor and current artifact/report hashes in local
run-state. `<content-root>` means `<run-root>/site/<targetDir>` when configured,
otherwise `<run-root>/site`. Keep all Git operations at `<run-root>/site`.
Review the intended one-article content change, then stage it with the strict CLI:

```bash
node '<skill-root>/bin/devlog.js' publish-guide --clone '<content-root>' --article '<article-path>' --evidence '<evidence-json>' --cover '<reviewed-cover.png>'
```

The helper writes validated content only. Normal concept Generate must continue
through commit, push and deployment verification; do not end the run after this
command merely because it returned success. If it refuses an occupied or retired
identity, preserve that identity and report the collision. Do not use publish-entry
or manual copying to bypass it. Existing-post rewrite is a separate task.

Before committing, inspect the content diff and returned `firstEntryForProject`.
When true, follow SKILL.md Step 5b: register the project in the site's actual route
registry, build and prove the new route exists, then run relevant site tests.
For every concept guide, build/test the actual consumer as appropriate and inspect
the top handoff, code rendering, cover loading, feed thumbnail and link destinations.
The standalone preview alone does not prove site compatibility. Correct issues and
rerun relevant checks before push. If correcting article or cover bytes, regenerate
matching evidence and restart from a fresh clone rather than bypass immutability.

Stage only the article, cover, manifest and any required registry change, then
inspect the staged diff before committing. Use the configured Git identity and
existing target-repository conventions. Inspect the target repository's instructions
and branch/CI policy first. Where features must pass through `dev` and promotion,
create a feature branch from the required base and use that PR path; the configured
branch is the deployment destination, not permission to push past its policy.
The direct-push example below applies only when the target policy permits it:

```bash
git -C '<run-root>/site' add -- '<article-relative-path>' '<cover-relative-path>' '<manifest-relative-path>'
# If needed, separately add the specific reviewed project-registry file.
git -C '<run-root>/site' diff --cached --stat
git -C '<run-root>/site' diff --cached
git -C '<run-root>/site' commit -m 'devlog: publish one concept guide'
git -C '<run-root>/site' push --no-tags origin '<branch>'
```

Record the resulting commit and push outcome. If push fails, retain the clone,
report the error and stop; do not retry automatically, force-push or discard work.
After successful push, follow SKILL.md Step 6 for the configured site route. Poll
its actual article URL roughly every 45 seconds for at most five minutes:

```bash
curl -s -o /dev/null -w '%{http_code}' -L '<actual-published-article-url>'
```

An HTTP 200 alone can be a fallback page: open/read the response to verify this
article's title and top handoff, then verify the actual cover/thumbnail URLs load
and inspect the deployed layout. Respect the site's route convention instead of
assuming a new URL shape. If the route remains absent, inspect registry/build
results and report it as not live. If `siteUrl` is unset, report pushed but
unverified with the repository link, not published success. Retain local run-state
and evidence until the outcome is recorded; never delete scratch before checking
push/deployment. Finish with the live article link when verified, observed checks,
and material limitations. No extra approval step is introduced for publication
already authorized by a normal Generate request; explicit drafts remain drafts.

## API and receipt

`publishGuide({ cloneDir, articlePath, evidencePath, coverPath? })` is exported
from `lib/publish_guide.mjs`. `cloneDir` is the existing content root inside the
publishing clone (including configured `targetDir`). `articlePath` and optional
`coverPath` are ordinary local paths relative to the invocation directory.
The API validates all evidence before writing content, then delegates to the
unchanged `publishEntry`. It never commits or pushes.

Evidence JSON schema 1:

```json
{
  "schema": 1,
  "anchor": { "project": "example", "version": "v1.2.0", "date": "2026-09-09" },
  "articleSha256": "<SHA-256 of exact article bytes>",
  "agentPrompt": { "path": "agent-prompt.txt", "sha256": "<SHA-256>" },
  "execution": { "path": "execution.json", "sha256": "<SHA-256>" },
  "adaptation": { "path": "adaptation.json", "sha256": "<SHA-256>" },
  "review": { "path": "review.json", "sha256": "<SHA-256>" },
  "coverSha256": "<required only when supplying coverPath>"
}
```

All SHA-256 values are lowercase 64-character hex strings. Referenced files
resolve relative to the evidence file, not the current working directory.
`agent-prompt.txt` must exactly equal the preview helper's copy payload: prompt,
two newlines, `<reference-guide>`, the trimmed article with the handoff block
removed, and closing `</reference-guide>`, with the helper's newline placement.
Use the `prepare-guide` output; do not maintain a second hand-edited payload.

Every execution/adaptation/review JSON report must contain these common fields:

```json
{
  "status": "passed",
  "summary": "Concrete observations and scope of this run.",
  "articleSha256": "<same exact article SHA-256>",
  "agentPromptSha256": "<same exact payload SHA-256>"
}
```

The execution report additionally contains a nonempty `commands` array:

```json
{
  "commands": [
    {
      "command": "node --test",
      "exitCode": 0,
      "output": { "path": "logs/tests.txt", "sha256": "<SHA-256>" }
    }
  ]
}
```

Output files resolve relative to the execution report. They must contain actual
observations and match their hashes. Include each required successful check;
retain failed attempts separately and describe corrections in the summary.
Do not invent a successful command or replace actual output with a claim.

The adaptation report additionally identifies the starting and resulting
fixture (paths, immutable revisions, or durable artifact identifiers), and
records a nonempty list of independently observed checks:

```json
{
  "fixture": { "original": "fixtures/before", "result": "fixtures/after" },
  "independentChecks": [
    { "check": "Existing public imports", "observation": "No side effects under invalid CLI arguments", "passed": true }
  ]
}
```

The review report additionally contains `reviewer` (nonempty identifier) and
`blockingFindings: []`. Explain the substantive review in its `summary`; an
empty findings array alone is not a review. When a cover is supplied, both the
evidence and review must contain its `coverSha256`, and the review must also
contain nonempty `coverReview` observations. The decoded cover must be a
single-frame true-color 1600×900 PNG. Changes to art invalidate its visual review.

These are consistency checks on local records. Hashes do not establish that a
command actually ran, that a reviewer was independent, or that observations are
correct. The agent must perform and inspect the work before writing the records.
Do not describe `evidenceValidated: true` as independent execution verification.

## Existing posts and failure behavior

This command refuses an occupied article, cover, manifest identity, or tombstone.
Even a manifest entry whose article is absent is occupied; use a deliberate
editorial repair workflow. Consolidating or rewriting published posts is a
separate explicitly scoped task that preserves URLs and existing identities.
There is no force option, migration, or change to old posts in this command.

Missing files, stale hashes, lint failures, failed/unobserved checks, anchor
mismatches and invalid covers fail before content mutation. After validation,
the existing publisher retains its existing article-then-manifest write behavior;
a disk failure is not an atomic rollback. Publish serially: neither helper
provides a multiprocess lock. Keep local evidence private unless deliberately
reviewed for inclusion in the public repository.
