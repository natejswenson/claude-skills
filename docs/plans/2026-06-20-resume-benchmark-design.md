---
ticket: "#N/A"
title: "Resume Generator Benchmark — accuracy + speed on real resume × real jobs"
date: "2026-06-20"
source: "design"
---

# Resume Generator Benchmark

A reproducible CLI benchmark that measures the **accuracy** and **speed** of the
`resume` skill's tailoring pipeline, using Nate's **real résumé PDF** as the
canonical input and a curated set of **real job postings** spanning his target
role distribution (DevOps / Platform / SRE / AI-LLMOps).

## Motivation

The skill already has a quality eval (`npm run eval` → `scripts/eval/run-eval.mjs`)
that runs the real `tailorResume` pipeline and scores G1–G4 + fitness + rule
compliance. Two gaps relative to "evaluate performance/accuracy **and speed** of
my resume generator":

1. **No timing.** Nothing in the existing harness measures wall-clock — the
   single most user-visible performance characteristic (tailoring is a ~1–2 min
   LLM step).
2. **Synthetic inputs.** It uses 9 archetype `.txt` résumés and synthesized JD
   text, not Nate's actual résumé or real postings.

This benchmark reuses the existing scorer and faithfulness rules, and adds:
real-PDF ingestion, real cached job fixtures, per-phase timing, a JD-coverage
metric, a **$0 subscription-CLI LLM judge**, and a discrimination check.

## Decisions (resolved with user)

- **LLM-as-judge: YES, but routed through the local Claude Code CLI** (`claude -p`),
  not the billed Anthropic API. Confirmed feasible: `CLIAdapter.completeStructured`
  already runs schema-validated `claude -p` on the subscription at $0. The judge
  prompt returns fixed-shape JSON, so it routes through the same adapter via
  `--json-schema`. Cost = $0; the only price is wall-clock (~20–40s per judge call).
- **Inputs are cached, not live.** Real postings are sourced once (web search) and
  cached as text fixtures so the benchmark is deterministic and regression-safe.
  Live URL extraction has its own separate fixture track (`scripts/fixtures/extract/`)
  and would add network flakiness to a metric that must be reproducible.

## Architecture

```
scripts/
├── fixtures/benchmark/
│   ├── jobs.mjs            NEW — ~6 real postings, cached text (existing fixture shape)
│   ├── resume.pdf          NEW — copy of Nate_Swenson_Resume (12).pdf  [gitignored]
│   └── README.md           NEW — provenance + how fixtures were sourced
├── scorer/
│   └── judge-cli.mjs       NEW — G1 tailoring-fit judge via subscription CLI ($0)
└── eval/
    ├── benchmark.mjs       NEW — the harness (timing + scoring + report)
    └── keyword-coverage.mjs NEW — deterministic JD requirement coverage
```

Reused as-is: `lib/pipeline.ts` (`loadResumeText`, `tailorResume`),
`scripts/scorer/index.mjs` (`scoreEval` for G2/G3/G4 + fitness),
`scripts/eval/rules.mjs` (`checkRules` faithfulness), `lib/llm/cli.ts` (`CLIAdapter`).

## Data flow (per job)

```
real PDF ──loadResumeText──▶ resumeText (cached once, reused across all jobs)
                                  │
cached JD text ───────────────────┤
                                  ▼
                         [t_tailor] tailorResume(resumeText, jobText)  ← LLM, ~1–2min, $0
                                  │ ResumeJSON
                ┌─────────────────┼──────────────────────────────┐
                ▼                 ▼                              ▼
   [t_render] renderPdf   checkRules(resume,         scoreEval(resume) → G2/G3/G4/fitness
   (~0.5–1s, optional)     {sourceText: resumeText})  keywordCoverage(resume, jobText)
                           → faithfulness violations  [t_judge] judgeCli(resume, jobText) → G1 ($0)
```

The résumé is parsed **once** (it's the same input for every job); only the job
text and downstream scoring vary per case.

## Metrics

### Speed (free, every run)
Per job, wall-clock via `performance.now()`:
- `t_parse` — résumé parse (measured once; same input)
- `t_tailor` — LLM tailoring **[headline]**
- `t_judge` — CLI judge (when enabled)
- `t_render` — PDF render (when `--render`)
- `t_total`

Aggregates: per-phase **mean / p50 / p95**, total suite wall-clock.

### Accuracy (per job)
| Metric | Source | Cost | Gate |
|---|---|---|---|
| **Faithfulness** (no fabrication vs real résumé) | `checkRules(resume, {sourceText})` | $0 | **HARD: violations must be 0** |
| **JD coverage** | `keywordCoverage` — % of JD key requirements present in tailored output | $0 | soft (reported, floor configurable) |
| **G1 tailoring-fit** | `judge-cli.mjs` (subscription `claude -p`) | $0 | soft floor (default 50) |
| **G2 word usage / G3 not-AI / G4 writing / fitness** | `scoreEval` (L1+L2) | $0 | G3 hard floor 40 (existing) |

### Discrimination check (suite-level)
The low-fit control job (e.g. Frontend Engineer) must score a **G1 (and fitness)
measurably below the median of the matched DevOps/Platform/SRE/AI roles**. This
proves the accuracy metric *separates* good tailoring from bad — a benchmark
where everything scores ~70 measures nothing. Reported as PASS/FAIL with the gap.

## Job fixture set (~6 real postings, sourced by Claude)

| # | Role | Fit | Tests |
|---|---|---|---|
| 1 | Senior DevOps Engineer | high | baseline close-match |
| 2 | Platform Engineer | high | platform/IaC emphasis |
| 3 | Site Reliability Engineer | high | SRE/observability surfacing |
| 4 | AI/LLMOps or AI Agent Engineer | high | **does tailoring surface his Claude-agent work?** |
| 5 | Staff/Principal Platform Engineer | stretch | seniority-stretch behavior |
| 6 | Frontend Engineer (control) | **low** | discrimination — must score lower |

Each fixture uses the existing shape (`id, archetype, ats, title, company,
sourceUrl, text`) with `archetype: "nate-devops"`. Real `sourceUrl` preserved;
`text` is the cached posting body the scorer consumes.

## API Surface

```js
// scripts/scorer/judge-cli.mjs
//   Same contract as judgeTailoringFit but routed through the subscription CLI.
//   No apiKey, no budgetGate (free). Returns score 0–100 + breakdown.
export async function judgeTailoringFitCli(
  { resume: object, jobText: string, model?: string }
): Promise<{ score: number, breakdown: object }>;

// scripts/eval/keyword-coverage.mjs
//   Deterministic JD requirement coverage. Extracts candidate skill/keyword
//   tokens from the JD, checks presence across the tailored résumé's text.
export function keywordCoverage(
  resume: object, jobText: string
): { coverage: number, matched: string[], missed: string[] };

// scripts/eval/benchmark.mjs  (CLI entry; npm run benchmark)
//   Flags: --resume <path> (default fixtures/benchmark/resume.pdf)
//          --jobs <id,id>   (default: all fixtures)
//          --judge          (enable CLI G1 judge; $0, adds wall-clock)
//          --render         (also render PDF + time it)
//          --json           (machine-readable report)
//          --mock           (MOCK_LLM=1 wiring check, instant, $0)
```

## Invariants

**Checkable by inspection:**
- `benchmark.mjs` sets `process.env.LLM_MODE = "cli"` before importing the
  pipeline — guarantees tailoring AND judge run on the subscription, never the
  billed API. (The one billed path, `scorer/judge.mjs`, is never imported here.)
- No `ANTHROPIC_API_KEY` is read anywhere in the benchmark path.
- The résumé is parsed exactly once per suite run.
- Every timing is captured with a monotonic clock (`performance.now()`), not
  `Date.now()`.

**Requires tests:**
- MOCK mode (`--mock`) completes with $0 and no `claude` spawn, exercising the
  full report path (wiring check, CI-safe).
- Faithfulness gate fails the run (non-zero exit) when `checkRules` finds a
  violation against the real résumé source.
- Discrimination check correctly flags when the control job does NOT score below
  the matched-role median.

## Cost & time

- **Tailoring:** $0 (subscription CLI). **Judge:** $0 (subscription CLI).
- **Wall-clock, full 6-job run with `--judge`:** ~6 × (1–2 min tailor + 20–40s
  judge) ≈ **12–18 min**. Without `--judge`: ~6–12 min. `--mock`: seconds.
- No billed API calls anywhere. The existing billed judge (`scorer/judge.mjs`)
  is left untouched and unused by this harness.

## Resolved decisions

1. **Real résumé PDF:** RESOLVED — copy to `scripts/fixtures/benchmark/resume.pdf`
   and **gitignore it**. Benchmark is reproducible locally; the personal résumé
   never ships in a public release. `--resume` defaults to this path.
2. **Job count:** 6 (covers the distribution + 1 control). Easy to add later;
   each adds ~1–2 min/run.

## Acceptance criteria

- `npm run benchmark -- --mock` runs in seconds, $0, prints the full report.
- `npm run benchmark` runs the real pipeline over all fixtures, prints per-job
  accuracy + per-phase timing + suite aggregates (mean/p50/p95) + discrimination
  verdict, exits non-zero on any hard-floor or faithfulness violation.
- `npm run benchmark -- --judge` adds the $0 CLI G1 tailoring-fit score.
- `--json` emits a machine-readable report for regression tracking.
- A new `scripts/benchmark.test.mjs` (MOCK, $0) is wired into `npm test`.
