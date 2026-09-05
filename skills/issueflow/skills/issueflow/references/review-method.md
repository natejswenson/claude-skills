# review-method — how the pull request is attacked

This file is the source the review briefs are rendered from. `brief.mjs`
splices each `## angle: <id>` block, the verifier contract and the fixer rule
into the briefs verbatim, so the wording here is the wording a reviewer
reads. Edit it here, never in a brief.

Most of the angle wording is Claude Code's own `/code-review` methodology,
kept because it was measured, not because it was ours. Two angles are house
additions: `intent`, which asks whether the diff does what the approved plan
says and whether the tests prove the reported behaviour, and the rule that
cleanup angles run in round one only and yield nits only.

## The shape of a round

```
finders (2–5, opus, one angle set each) ──▶ candidates
    ──▶ verifiers (≤8, opus, ≤3 items each, every prior open finding a mandatory item) ──▶ verdicts
    ──▶ registrar (code) ──▶ one GitHub review, inline threads, transitions on prior threads
    ──▶ fixer (sonnet; opus once a major is still-open) ──▶ one commit, a push, a fix report
    ──▶ next round, until open majors = 0 (nits may remain) or the cap
```

**Severity is three-valued.** `major` — CONFIRMED wrong behaviour, data
loss, a security hole, or a test that does not prove the fix; or PLAUSIBLE on
a realistic runtime path. `nit` — real but cosmetic, style, cleanup. `pre-existing`
— real, and not introduced by this diff. Only `major` blocks. "Only nits
remain" is the definition of done, not a to-do list.

**Convergence is code, not judgment.** After round 1 no new nit posts. On
lines the last fix did not touch, a new candidate posts as a major only if
CONFIRMED — PLAUSIBLE on unchanged code is a note in the body, because fresh
finders each round will otherwise manufacture a new plausible major forever.
Four rounds is the cap; the open majors are handed to a human.

## The anti-self-censorship rule

Pass every candidate with a nameable failure scenario through — finders that
silently drop half-believed candidates bypass the verify step and are the
dominant cause of misses. Do NOT let one angle's conclusions suppress
another's — if two angles flag the same line for different reasons, record
both. The verifier decides what is real; the finder's job is recall.

## angle: line-by-line

Read every hunk in the diff, line by line. Then read the enclosing function
for each hunk — bugs in unchanged lines of a touched function are in scope
(the change re-exposes or fails to fix them). For every line ask: what input,
state, timing, or platform makes this line wrong? Look for inverted/wrong
conditions, off-by-one, null/undefined deref, missing `await`, falsy-zero
checks, wrong-variable copy-paste, error swallowed in catch, unescaped regex
metachars.

## angle: removed-behaviour

For every line the diff DELETES or replaces, name the invariant or behaviour
it enforced, then search the new code for where that invariant is
re-established. If you can't find it, that's a candidate: a removed guard, a
dropped error path, a narrowed validation, a deleted test that was covering a
real case.

## angle: cross-file

For each function the diff changes, find its callers (grep for the symbol)
and check whether the change breaks any call site: a new precondition, a
changed return shape, a new exception, a timing/ordering dependency. Also
check callees: does a parallel change in the same diff make a call unsafe?

## angle: intent

Read the approved plan named in your brief, then the issue. For each thing
the plan says the change does, find where the diff does it — and for each
thing the diff does, find where the plan asked for it. A plan item the diff
skipped without a Deviations entry is a candidate; so is a change the plan
never named. Then read the tests in the diff against the issue, not against
the code: would each new assertion fail on the behaviour the issue reports,
or only on the code as it happens to be written? A test that would pass
without the fix is a major.

## angle: language-pitfalls

Scan for the classic pitfalls of the diff's language/framework — for
example: JS falsy-zero, `==` coercion, closure-captured loop var; Python
mutable default args, late-binding closures; Go nil-map write, range-var
capture; SQL injection; timezone/DST drift; float equality. Flag any instance
the diff introduces.

## angle: conventions

Find the CLAUDE.md files that govern the changed code: the repo-root
CLAUDE.md, plus any CLAUDE.md in a directory that is an ancestor of a changed
file (a directory's CLAUDE.md only applies to files at or below it), and a
root `REVIEW.md` if there is one. Read each that exists, then check the diff
for clear violations of the rules they state. Only flag a violation when you
can quote the exact rule and the exact line that breaks it — no style
preferences, no vague "spirit of the doc" inferences. In the finding, name
the file and quote the rule. If no such file applies, return nothing for this
angle.

## angle: reuse

Flag new code that re-implements something the codebase already has — grep
shared/utility modules and files adjacent to the change, and name the
existing helper to call instead. Cleanup: a nit, never a major.

## angle: simplification

Flag unnecessary complexity the diff adds: redundant or derivable state,
copy-paste with slight variation, deep nesting, dead code left behind. Name
the simpler form that does the same job. Cleanup: a nit, never a major.

## angle: efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O,
independent operations run sequentially, blocking work added to startup or
hot paths. Name the cheaper alternative. Cleanup: a nit, never a major.

## angle: altitude

Check that each change fixes the root cause at the right depth rather than
patching a symptom with a fragile bandaid. Special cases layered on shared
infrastructure are a sign the fix isn't deep enough — prefer the simpler,
more general change to the underlying mechanism over adding special cases,
and name that change. Cleanup: a nit, never a major.

## verifier

For each NEW candidate handed to you, return exactly one of:

- **CONFIRMED** — you can name the inputs or state that trigger it and the
  wrong output or crash. Quote the line at the head commit.
- **PLAUSIBLE** — the mechanism is real, the trigger is uncertain (timing,
  environment, configuration). State what would confirm it.
- **REFUTED** — factually wrong (the code does not say that), provably
  impossible (a type, a constant, an invariant — show it), already handled in
  this diff (cite the guard), or pure style with no observable effect. Quote
  the line that proves it.

**PLAUSIBLE by default** — do not refute a candidate for being "speculative"
or "depends on runtime state" when the state is realistic: concurrency races,
nil/undefined on a rare-but-reachable path (error handler, cold cache,
missing optional field), falsy-zero treated as missing, off-by-one on a
boundary the code does not exclude, retry storms / partial failures, a
regex/allowlist that lost an anchor. These are PLAUSIBLE. **REFUTED only when
constructible from the code.**

Then rate what survives: `major`, `nit` or `pre-existing` — and say whether
the diff introduced it (`introduced_by_diff`). Cleanup angles are nits. A
test that would pass without the fix is a major.

For each PRIOR finding handed to you (it has an `f-` id and the line it was
filed on at the previous head), return exactly one of:

- **fixed** — the failure scenario can no longer occur. Quote the guard, the
  changed line, or the new test at the current head. **A moved line is not a
  fix**: if the same mechanism now lives ten lines down, it is `still-open`,
  with the new line.
- **still-open** — the scenario still occurs. Give the current line.
- **withdrawn** — you can now REFUTE it, by the same standard as above. Quote
  the line that proves it.

If a prior finding carries a dispute — the fixer said why it did not change
it — rule on the dispute explicitly: `withdrawn` if the fixer is right,
`still-open` with a sentence saying why not if the fixer is wrong.

## fixer

Fix each open finding by changing the work — the code, the test, the
evidence — never by arguing with the finding. If a finding is wrong, mark it
`not-changed` with one sentence saying why, and move on: **note the skip
rather than arguing with it.** The next round's verifier rules on the dispute;
you do not. Never weaken or delete a test to clear a finding. Run the suite,
append the real output to the evidence file, and make ONE commit for the
round whose message lists the finding ids it addresses.
