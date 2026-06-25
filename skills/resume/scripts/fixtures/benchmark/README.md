# Benchmark fixtures

Inputs for the résumé-generator benchmark (`npm run benchmark`). See the design
doc: [`docs/plans/2026-06-20-resume-benchmark-design.md`](../../../../../docs/plans/2026-06-20-resume-benchmark-design.md).

## Layout

```
scripts/fixtures/benchmark/
├── README.md          (this file)
├── jobs.mjs           (7 real job postings: 5 high-fit + 2 low-fit controls)
├── sample-resume.txt  (small synthetic résumé — COMMITTED; used by the CI-safe
│                       --mock plumbing test, since resume.pdf is gitignored)
└── resume.pdf         (the real résumé under test — GITIGNORED, never committed)
```

## resume.pdf

The canonical input is the real résumé PDF, copied to `resume.pdf` and
**git-ignored** (`/scripts/fixtures/benchmark/resume.pdf` in `.gitignore`) so the
benchmark is reproducible locally while the personal résumé never ships in a
public release. `--resume <path>` overrides it.

It is ingested through the production `loadResumeText` path (`unpdf`/`pdf.js`,
`mergePages: true`), then the benchmark applies a second normalization pass
(collapse whitespace, strip soft hyphens, de-hyphenate line-break splits). A
**parse-time anchor check** asserts the extracted text contains the fixture
anchors (`swenson`, `goodleap`, case-insensitive) so a degraded extraction aborts
the run instead of scoring against garbage. Anchors are fixture-coupled — they are
only enforced for the default fixture, not a user-supplied `--resume`.

## jobs.mjs

7 cached job postings spanning the candidate's target distribution. Each carries
`{ id, archetype: "nate-devops", fit, control, ats, title, company, sourceUrl, text }`.

| # | id | Role | Fit |
|---|---|---|---|
| 1 | `j1-senior-devops` | Senior DevOps Engineer | high |
| 2 | `j2-platform-eng` | Platform Engineer | high |
| 3 | `j3-sre` | Site Reliability Engineer | high |
| 4 | `j4-ai-llmops` | Applied AI / LLMOps Engineer | high |
| 5 | `j5-staff-platform` | Principal/Staff Platform Engineer | high (stretch) |
| 6 | `j6-frontend` | Frontend Engineer | **low (control)** |
| 7 | `j7-ux-designer` | Product/UX Designer | **low (control)** |

`CONTROL_IDS` lists the two low-fit controls. The discrimination check requires
the controls to land **below the treatment median** on JD-coverage — proving the
metric separates on-stack from off-stack tailoring rather than scoring everything
the same.

### How these were sourced

- **Job text** — real postings surfaced via web search, written in the natural
  style of each source ATS (Greenhouse "About the role / What you'll do", Lever
  terser skills-list, Workday formal bullets, Ashby startup-casual). The cached
  `text` is what the scorer consumes; `sourceUrl` is preserved for provenance and
  **may rot**.
- The 5 high-fit JDs deliberately carry the candidate's exact stack (AWS, Terraform,
  Kubernetes, CI/CD, Datadog, SRE, LLM agents/evals) so tailoring has real keywords
  to surface; the 2 controls are genuinely off-stack (React/CSS/Figma) so the
  discrimination check can separate them.

### Bias caveat

Same-family: tailoring runs on Haiku and the optional G1/grounding judges run on
Claude — self-preference can inflate G1. Mitigated by making the
function-deterministic metrics (HARD `checkRules`, coverage, G2/G3, fitness) drive
every hard gate and the discrimination check; the judges are soft/corroborating
only. Single résumé (N=1) → the discrimination check is directional, not
statistical. See the design doc's Bias caveats.
