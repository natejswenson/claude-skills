# The rubric — where a clause comes from

A grade is worth exactly as much as the rubric behind it. The only rubric
nobody can argue with is the one the skill wrote down itself, so assay never
invents a standard: every clause is lifted verbatim out of a committed file and
carries the `file:line` it came from.

## What counts as a clause

A clause is an **imperative the skill bound itself to**. Three forms are
recognised, because contracts in this house use all three:

| Form | Example | Recognised by |
|---|---|---|
| prohibition | `**Never hand-write a brand value.**` | never / always / must / do not / don't / refuse |
| positive imperative | `**Announce the skill once, at the start**` | a leading base-form verb |
| contrastive | `**One script call, not a pipeline.**` | `, not …` / `, never …` |

Only **bolded** spans are considered. That is not a style rule — bold is how
every SKILL.md in this repo marks the difference between a rule and the
paragraph explaining it, and grading against explanation produces findings
nobody can act on.

## What is deliberately not a clause

- Prose that motivates, illustrates or reassures. "smith exists because…" is
  not something a run can violate.
- Headings, table cells naming a command, and code fences.
- Anything under 15 or over 400 characters. Below that it is a label; above it,
  a paragraph wearing bold.

## The five sources, and why they are not equal

| Tag | From | Severity | Is |
|---|---|---|---|
| `rule` | the `## The one rule` section | critical | the thing the skill refuses to do; outranks everything |
| `skill` | bolded rules elsewhere in SKILL.md | high | that skill's own promises |
| `press` | inside a `press:` generated region | medium | the shared house contract, identical across skills |
| `inv` | `skill-invariants.json` → `prose[]` | high | guardrails no code enforces |
| `house` | `CLAUDE.md` → Golden rules | high | repo-wide law the run is also bound by |

A press-region violation and a one-rule violation are both real and are not the
same kind of wrong. Flattening them into one severity is how a report stops
being read: the reader learns that "critical" sometimes means "a table was
formatted oddly".

## Two deduplications that matter

1. **A rule restated is one rule.** The one-rule section usually repeats
   verbatim under "Rules that are not negotiable". Cited twice, it inflates the
   clause count and any coverage number computed from it.
2. **An invariant `pattern` is a fragment, not a clause.** Those strings exist
   so a test can grep SKILL.md; they are cut out of sentences that are already
   clauses. An `inv` clause whose text is a substring of another clause is
   dropped — otherwise the coverage gap fills with duplicates and overstates how
   much went unchecked.

## The recall limit, stated plainly

Clause extraction is a heuristic over markdown, not a parser of English. It
**will** miss rules phrased in ways the three forms above do not cover, and it
has no way to know that it missed them.

This is why every report prints its coverage gap, and prints it beside the
findings rather than in a footnote. `0 findings` is never a statement about a
run; it is a statement about the clauses something actually examined. A report
that lets a reader confuse those two is worse than no report — it converts
ignorance into confidence.
