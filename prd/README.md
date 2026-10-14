# Product requirements

PRDs describe what users need and why. Write `NNNN-short-description.md` by copying
`_template.md`; authors choose numbers. Keep files at their original paths throughout
their lifecycle. Use N/A with an explanation for inapplicable sections.

## Author and review

Cover every template section. State requirements separately from implementation
suggestions, observable acceptance criteria and concrete checks. A ready requirement
is self-contained: incorporate necessary linked constraints and decisions. Links
are context, not recursively loaded task inputs. Resolve consequential choices,
remove placeholders, and split oversized/unrelated work into separate ready PRDs.

Lifecycle labels are human/agent-maintained documentation, not CLI states:

- `draft`: still being authored.
- `ready`: complete with no blocking choice or placeholder.
- `in-progress`: an actual factory run exists.
- `delivered`: endpoint observed, with its commit/PR link.

Scaffolding creates no ready PRD and never changes lifecycle labels. Update labels
only when requested/included in reviewed work, before final verification/review.
Do not dirty a delivered tree to add a label; use a subsequent reviewed change.

## Run a ready requirement

Review and commit the ready PRD on the intended base before dependent work. This
is workflow guidance; the CLI supports arbitrary task files and makes no implicit
commit. Read the full PRD and relevant designs. Pass every full acceptance criterion
as a separate literal `--criterion` in document order; labels/meaning stay intact.

Complete synthetic example: author `prd/0001-example.md` with this self-contained
one-criterion request (N/A is explicit because this is only an intake demonstration):

```markdown
# 0001 — Example greeting
Status: ready
## Problem and users
Example CLI users need a greeting.
## Desired outcome
Running greeting.py prints Hello.
## Scope
Add greeting.py with the greeting.
## Non-goals
N/A: no other functionality.
## User workflow
Run python3 greeting.py.
## Requirements
Print Hello followed by a newline and exit zero.
## Acceptance criteria
- AC1: python3 greeting.py exits zero and prints exactly Hello followed by a newline.
## Constraints and compatibility
Use standard-library Python 3.11+.
## Dependencies
N/A: no additional prerequisites beyond a configured Git project.
## Verification
Run python3 greeting.py; assert its exit code and exact stdout in a Python test.
## Risks and open questions
N/A: this synthetic scope has no unresolved choice.
## Delivery and follow-up
Verified changes and an observed draft PR; no implicit merge.
```

After review/commit, choose a host-approved writable worktree root and run:

```sh
factory start --repo /path/to/app --task-file /path/to/app/prd/0001-example.md \
  --criterion "AC1: python3 greeting.py exits zero and prints exactly Hello followed by a newline." \
  --base main --branch feature/example-greeting \
  --worktree-root /path/to/approved/worktrees --json
```

`start` does not extract criteria or validate lifecycle labels. Follow the normal
investigation, reviewed private plan, implementation, executable verification,
independent code review and observed delivery loop. Resume the same run after an
interruption. Task text and explicit criteria are frozen; editing the original PRD
does not replace them. Consequential changes need user direction and a separately
planned replacement task, never saved-state edits. Do not scan/start all ready PRDs.

## Boundaries and setup

`design/` specifies how where needed; a linked design's necessary details belong
in the reviewed private plan. `.rules/` holds instructions/configuration. Do not
put settings fences in PRDs or treat Markdown as executed instructions. Private
runs, reviews, logs and receipts stay under the Git common-dir, outside source.

New `factory init` enrollment creates this folder together with settings.
`factory prd-init --repo /path/to/app` adds missing scaffold files to existing Git
projects without creating settings/runs/branches/commits. Existing regular files
are preserved byte-for-byte; there is no force/upgrade. Unsafe paths fail before
writes. Partial I/O failures report created paths that may be incomplete, without
rollback; inspect/repair partial content yourself. Rerun fills only missing files.
