# The probe catalogue

A probe is the part of a clause a machine is allowed to decide alone. Every one
of them is narrow on purpose, and every one declares what it is **not**
deciding, so the remainder goes to judgment instead of being silently scored as
clean.

A probe attaches to a clause by matching its text. If no clause in the contract
matches, the probe does not run and is not reported — a skill that never
promised to announce itself cannot be graded on announcing itself.

## The eight

| Probe | Fires on | Cannot decide |
|---|---|---|
| `file-contents-in-chat` | an un-piped `cat`/`bat`/`less` of a source file | a file printed by a non-Bash tool, or a dump the agent then summarised |
| `announce-once` | zero announcements, or a second one | whether an announcement that exists is phrased as asked |
| `pipeline-reshaping` | a pipe into `sed`/`awk`/`python3 -`/`node -e` | whether the script could reasonably have returned that shape |
| `unobserved-test-claim` | "tests pass" with no runner invoked earlier | every *other* unobserved claim — "it works", "CI is green" |
| `question-budget` | more questions than the clause allows | a question asked as prose rather than through the question tool |
| `pr-into-main` | `gh pr create --base main`, or a push to main | a PR opened via the GitHub MCP tools or the web UI |
| `brand-bypass` | a SKILL.md/README.md edit in a run that never called press | whether the edit actually touched a generated region |
| `done-without-freeze` | "the skill is done" with no freeze before it | softer overclaims — "basically finished", "ready to ship" |

## Why they are this narrow

The temptation with a grader is to make each probe clever enough to catch the
whole clause. That trade is always bad. A probe that guesses manufactures
findings, a reader who meets two wrong findings stops trusting the report, and
an untrusted report catches nothing at all no matter how much it detects.

So the rule is: **decide the part that is decidable, name the rest.** The
`cannot` field is not an apology, it is the interface to the judgment half —
it is what the model is told to look at once the machine has finished.

`brand-bypass` is the clearest case. A trace records that a file was edited, not
which bytes changed, so the probe cannot know whether a generated region was
touched. It therefore under-reports deliberately: it fires only when press was
never invoked at all in the run. A version that guessed from filenames would be
wrong often enough to poison the report.

## The rule every probe obeys

A probe may only emit a finding that names **a clause id that exists** and **an
event id that exists**. It is not enforced probe by probe — `resolveFindings`
checks every finding before any of them reach a report, and a finding that fails
is *dropped and counted*, never softened into a "possible" finding.

A possible finding is an assertion with a hedge in front of it, and hedged
assertions are how a grader starts hallucinating politely.

## Absence findings

Some violations have no event: a run that never announced itself has no
announcement to cite. These cite the **first assistant turn** — the place the
announcement was due and is verifiably not present. That is a real event whose
content a reader can check, which keeps the citation rule intact instead of
carving an exception into it.

## Adding a probe

1. It must name the exact event that breaks the clause. If it cannot, it is
   judgment, not a probe.
2. It must declare `cannot`. A probe with nothing in that field is claiming to
   decide a clause completely, which no probe here does.
3. It must be two-sided in the tests: a run that violates it goes red **and** a
   clean run goes green. A probe only ever tested against violations will
   happily fire on everything.
