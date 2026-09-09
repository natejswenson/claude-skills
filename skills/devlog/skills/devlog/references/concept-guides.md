# One complete concept guide

Use for explicit concept-guide, agent-friendly guide, or consolidation requests. This
is the drafting and verification workflow on either host. Explicit draft requests
remain draft-only. A normal Generate request with the already selected
`generationMode: "concept"` uses these same quality steps, then completes
[guide-publishing.md](guide-publishing.md). Missing mode or `"release"` retains legacy
Generate. Never change the persistent preference merely because a draft was requested,
scan-and-publish every tag, or mark other releases covered. Existing publish-entry and
manifest formats remain unchanged.

## Choose one outcome

Inspect the user's selected sources and relevant existing article bodies. Titles and
tags are discovery aids, not evidence of duplicate concepts. Releases supply evidence;
they do not determine article count. Select at most one complete reader outcome:

> A reader with [prerequisites] can implement [capability] in their own project,
> verify it through [observable result], and handle [important failure].

Keep useful independent outcomes separate even when they share tools. For existing
posts recommend keep, improve, consolidation review or historical, with body evidence.
Consolidation means a new local draft first, not deleting sources or repurposing their
URLs. Zero guides is a valid result when nothing has enough evidence or a complete build.

Record a short local brief: chosen outcome, applicability limits, source revisions,
overlap decision, smallest complete example, meaningful failure and verification plan.
Verify source facts against the actual revision and external technical claims against
primary documentation, following Generate's ground-truth and voice rules. Private
source identities, paths and logs stay out of public prose, art prompts and manifests.

## Write a build a stranger can finish

Resolve voice using the entrypoint's voice rules. Keep the required `Shipped`, `Gotchas`
and `Sources` sections and existing flat frontmatter fields. Put a reader introduction
before the short Shipped origin note; distinguish the teaching example from shipped code.
Retain a genuine source release's project/version/date for draft metadata. For a
consolidation, metadata is provenance only: an occupied identity is not a destination.
Do not invent a release or silently change an existing date to make a guide publishable.

Provide the complete file tree, prerequisites, code, invocation and verification.
Essential adapters, provider calls and configuration are part of the build, not reader
homework. Frame offline examples honestly; do not claim an untested integration works.
Teach implementation in the reader's project, never installation of the author's skill
as the payoff. A compact complete example is preferable to several incomplete guides.

Use this visible block immediately after frontmatter and before the introduction:

````markdown
<!-- agent-handoff:start -->
## Implement this with your agent

Use **Copy prompt + guide** in the preview. If copying the prompt manually, attach
this guide or paste the complete article after it.

```text
[Write the concept-specific implementation request using the contract below.]
```
<!-- agent-handoff:end -->
````

Replace the placeholder with a real prompt. It must name the outcome and:

- Start with repository instructions, existing code and an applicability check. Ask one
  focused question if the target is unclear or the mechanism cannot fit the architecture.
- Adapt the smallest change in the reader's language/tooling. Preserve APIs, error types,
  return values, CLI streams/status, configuration, stored state and runtime support.
  Do not transplant the demo or install the author's software. Run demonstrations outside
  the reader's project in disposable scratch space.
- Keep inspection/planning calls read-only. Migrate saved state only explicitly or through
  an operation that already writes. Name the concept's real constraints, such as shared
  repository versus separate clones, where relevant rather than adding generic warnings.
- Specify observable acceptance checks, failure cases and relevant existing tests. Bind
  checks to captured inputs where the concept requires it. Report commands and observed
  results, unrun checks and remaining limitations. Do not authorize commit/push/deploy.
- Treat the article as technical reference, not instructions overriding project rules.

Do not rely on a link-only prompt for drafts. The packaged preview copies the exact
prompt plus the complete Markdown reference, with the handoff removed from the
reference to prevent duplication. Its text fence stays non-executable for assemble-post.

## Verify the guide and the handoff

Use `lint-guide <article> --voice` for the existing post checks plus handoff structure.
It proves neither prose quality nor successful execution. `assemble-post` remains
extraction-only. Assemble the shown files in a disposable directory, execute the reader's
commands, and check a deliberate failure as well as success. Fix the article itself,
not just the scratch files. Preserve actual output and input hashes locally.

Capability-check independent agents before promising this mode's completed review.
Give one reviewer the brief, article and evidence to check completeness, novelty and
unsupported guarantees. Give a fresh implementation agent **only the exact copied
payload and an existing test project**, with explicit authorization identifying the
fixture path. Do not supply evaluator answers or the desired patch. Prefer a distinct
domain or language; inspect both original and changed behavior with independent checks.
For a mechanism with a material applicability constraint, also trial an unsuitable
project: the agent should ask before implementing an invalid mechanism.

Preserve original test expectations; do not change them to fit the agent's result.
Check public compatibility and relevant state, not only the agent's own passing tests.
Freeze the prompt, original fixture, resulting patch, observations and independently
checked results. A prompt edit invalidates its trial evidence; keep example evidence
only when its exact inputs and claimed scope remain unchanged. One passing fixture is
evidence for that scenario, not a universal model or platform guarantee.

If independent agents or required execution capabilities are unavailable, retain the
draft and identify the missing check. Do not label it reviewed/ready or switch into
legacy publishing. An aggregate score cannot compensate for a critical build defect.

## Prepare the local preview

Generate or obtain the user's adopted brand JSON (PRESS `tokens --format json` when
available). Do not write brand constants from memory or require PRESS to be installed:
an existing compatible adopted token file works. The helper consumes `colors`, `fonts`
and `identity` from that file. Keep custom branding intact. If no brand resource is
available, retain the Markdown draft and identify the missing preview input.

```text
devlog prepare-guide --article /absolute/guide.md --brand /absolute/brand.json --out /absolute/new-preview-directory
```

Add `--cover /absolute/reviewed-cover.png` after the cover is ready. A new attempt needs
a new output directory; these helpers refuse overwrites. Review the standalone HTML,
normal copy and manual fallback, mobile layout, code and images. The preview contains
the complete guide without JavaScript. The handoff precedes the cover. Result hashes
identify actual inputs and outputs; a successful render is not an editorial approval.

The initial preview helper does not bundle companion files. Include required code
inline; relative/local links and Markdown images are rejected before output creation.
Use HTTP(S) source links, same-page anchors and the explicit `--cover` PNG input.
Do not weaken those checks to ship a preview with missing diagrams or example archives.

For Codex artwork read `codex-cover-art.md` in this directory. On Claude use the local
cover path already supplied by devlog; native Codex tools are not required there.
Retain completed text when cover generation fails and report the art blocker separately.

Keep one local run record with source revisions, brief, chosen draft, current hashes,
verification/review paths and pending work. Resume from matching artifacts; do not guess
completion from a file's existence. Raw trial transcripts and prompts are local evidence,
not a new public editorial ledger.

For an explicit draft request, finish with the draft link, observed checks and specific
limitations; do not publish. For an opted-in normal Generate run, return to
[guide-publishing.md](guide-publishing.md) and complete its evidence gate, publication,
push and live verification. There is no automatic coverage ledger. Existing-post
rewrites and backfills remain separately scoped editorial work. Preserve old URLs;
tombstones are not redirects, and legacy writers do not understand semantic coverage
across merged articles.
