---
title: "Resume skill: agent-native rewrite, take 2"
date: "2026-07-08"
source: "design"
---

# Resume skill: agent-native rewrite, take 2

## Context

`skills/resume` has been rewritten twice in one day. v0.3.0 (shipped, on disk, 15/15 tests
passing) is a full Node/TS CLI app (~9,600 LOC, ~100 files) that shells out to a subprocess
`claude -p` for tailoring — a 5-tier job-extraction waterfall, a dual LLM adapter, UI progress
bars, and a 1,900-LOC eval/scorer harness, almost all of it built to work around *not* having a
live model at runtime (an artifact of the hosted web-app this was vendored from).

A first agent-native rewrite (v1.0.0, PR #27) deleted that surface: the invoking Claude Code
agent read the résumé, fetched the job posting, and tailored bullets directly in-conversation.
It passed CI, merged to `dev`, and was reverted the same day. Two reasons, both process failures,
not architecture failures: it was **never run end-to-end** against a real résumé/job before being
judged "no good" (the call was made on code review alone), and the user found the overall skill
structure "confusing, too much" — code and markdown mixed across `lib/`, `bin/`, `components/`,
`schemas/`, `scripts/` at the repo root.

This document + `2026-07-08-resume-eval-harness-design.md` (quality-gated separately, 7 rounds)
together specify the second attempt.

## Decisions

### Execution architecture — agent-native + plan-validate-execute

Two independent research agents (Domain Researcher + Impact Analyst), dispatched without seeing
each other's work, converged on the same recommendation, backed by Anthropic's own published
skill-authoring guidance ("concise is key," "set appropriate degrees of freedom," "prefer scripts
for deterministic operations," "create verifiable intermediate outputs," "build evaluations
first"):

- The agent reads the résumé (`Read`, native PDF/TXT/MD), gets the job text (paste/file, or
  `WebFetch` with a fallback procedure), and tailors bullets in-conversation per a rules reference
  file — no subprocess LLM call.
- The agent emits a schema-validated JSON intermediate (the "plan"), which a deterministic script
  validates (content-truth checks + a fix-and-retry loop) before rendering.
- This is nearly identical to the reverted v1.0.0's shape. A lightweight Challenger step confirmed
  the architecture wasn't what got it reverted — the process around it was.

### Root cleanliness — one markdown home, one code home

User's own framing, verbatim: *"To much Code, and js and messy root... skills can call
deterministic logic but they should not pollute the entire repo. The purpose is to hand off
thinking to the machine."* Saved to memory as a standing preference beyond this one skill (see
`skill-design-markdown-first` memory).

Resolution: all agent-facing prose lives in `references/`; **all** deterministic code — including
templates and the eval harness's own tooling — collapses into one `scripts/` directory, nested by
purpose (`scripts/templates/`, `scripts/evals/`), instead of `lib/` + `bin/` + `components/` +
`schemas/` + `scripts/` all sitting at root.

### Rendering, schema, validation, and templates stay as code — pushed back on explicitly

The user asked directly whether these four could become reference files instead, "think about
this and push back." Held the line on all four:

- **Rendering**: PDF is a binary format (xref tables, embedded fonts, byte-precise content
  streams). No amount of prose produces correct PDF bytes — the only way is to run a rendering
  engine. Prose-as-render would mean the agent writes-and-executes layout code live, every run,
  instead of running one tested script.
- **Templates**: the clearest case. Visual/layout precision (margins, pagination, font embedding)
  is exactly the kind of exact, run-to-run-reproducible correctness prose cannot guarantee — a
  "template" described in prose would look different every time it's used, which defeats the
  entire point of naming a template.
- **Validation**: deliberately a deterministic backstop *against* the agent's own self-grading
  blind spots on a high-stakes document. Banned-phrase/invented-number/exact-bullet-accounting
  checks are 100%-precision string/regex tasks — exactly where LLM self-checks are unreliable.
  This already caught a real bug once (a no-op-bullet issue, 0.2.0). Converting it to "the agent
  checks itself" removes the actual insurance.
- **Schema**: nuanced, one real concession made. The *description* of the JSON shape already
  lives in markdown (the agent reads it to know what to produce); the *runnable* zod contract
  folds directly into `scripts/validate.mjs` (no separate `schema.ts` file) since `validate.mjs`
  needs something executable to check structural correctness against.

### DOCX — recovered, not dropped again

v1.0.0 dropped `.docx` support outright (the `Read` tool doesn't parse it natively). This time:
extract the ~2-line `mammoth` branch already in `lib/parsing/resume.ts` into a standalone
`scripts/docx-to-text.mjs` shim the agent invokes when it hits a `.docx` file — not a full parser
tier, not a dropped format.

### "It must be evaluated" — load-bearing, not aspirational

The user's hard requirement, verbatim. Fully specified and quality-gated in
`2026-07-08-resume-eval-harness-design.md`: a real cost cap in code (not just a quote), a single
unambiguous PASS/FAIL signal, mandatory human sign-off on the harness's results summary, and one
live interactive run producing a PDF the user actually opens and confirms — before this redesign
is declared done. That last requirement exists specifically because an automated eval proves the
instructions work in isolation; it doesn't prove a live session reads `SKILL.md` the same way,
which is exactly the gap that sank v1.0.0.

## What this doesn't re-litigate

The full file-by-file retirement accounting (every `package.json` dependency, every
`scripts/*.test.mjs` file, every `package.json` script entry — verified independently across 7
red-team rounds, zero unresolved fates) lives in `2026-07-08-resume-eval-harness-design.md` and is
authoritative. The implementation plan executing both documents is
`~/.claude/plans/mellow-plotting-planet.md` (approved).
