# Perf optimization fixtures

End-to-end fixture set for the Haiku 4.5 perf optimization test suite. Designed to exercise the full pipeline (extraction + tailoring) across a deliberately diverse cohort distribution so the variant we ship doesn't silently regress on non-technical users.

See the design doc: [`docs/plans/2026-04-25-haiku-perf-optimization-design.md`](../../../docs/plans/2026-04-25-haiku-perf-optimization-design.md)

## Layout

```
scripts/fixtures/perf/
├── README.md          (this file)
├── index.mjs          (cohort matrix — pairs archetypes with jobs)
├── jobs.mjs           (28 job posting fixtures with sourceUrl + cached text)
└── resumes/           (9 archetype resume .txt files)
    ├── 01-swe-mid.txt
    ├── 02-sales-ae.txt
    ├── 03-rn-clinical.txt
    ├── 04-retail-mgr.txt
    ├── 05-restaurant-gm-messy.txt
    ├── 06-mktg-coord-messy.txt
    ├── 07-accountant.txt
    ├── 08-hvac-tech-messy.txt
    └── 09-teacher-elementary.txt
```

## Cohort matrix

| # | Archetype | Cluster | Messy? | Job fixtures |
|---|---|---|---|---|
| 1 | Software Engineer (mid-level) | Technical | clean | 3 |
| 2 | Sales AE (B2B SaaS) | Sales | clean | 3 |
| 3 | RN — ICU / Critical Care | Healthcare | clean | 3 |
| 4 | Retail Store Manager | Retail | clean | 4 (3 ATS + 1 paste) |
| 5 | Restaurant General Manager | Hospitality | **messy** | 3 (2 ATS + 1 paste) |
| 6 | Marketing Coordinator (early-career) | Marketing | **messy** | 3 |
| 7 | Senior Financial Analyst | Finance | clean | 3 |
| 8 | HVAC Service Technician | Trades | **messy** | 3 (2 ATS + 1 paste) |
| 9 | Elementary Teacher (K–3) | Education | clean | 3 (2 ATS + 1 paste) |

**Total: 28 (resume × job) pairs across 9 cohorts.**

The 3 messy fixtures (~⅓ of the matrix) deliberately introduce realistic mess — typos, tense mixing, awkward bullet starts, missing sections — to stress-test against the in-the-wild distribution rather than only optimize for clean Opus-generated output. Per the design doc bias-mitigation plan.

## ATS source distribution

Reflects real-world prevalence — users overwhelmingly paste LinkedIn URLs, with Workday and Greenhouse next. Ashby is intentionally underrepresented (newer, smaller share).

| ATS | Count | Notes |
|---|---|---|
| Workday | 7 | High real-world prevalence; parser-hostile |
| LinkedIn | 9 | Most common URL users paste |
| Greenhouse | 3 | Common at SaaS startups |
| Lever | 4 | Common at growth-stage SaaS |
| Ashby | 1 | Newer / smaller share |
| Paste-only (no URL) | 4 | Edge case for the paste-fallback path |

## How fixtures were generated

- **Resumes** — written by Claude Code (Opus 4.7) directly in-session via the Write tool. Cost: $0 (no API key call).
- **Job URLs** — sourced via WebSearch (also $0 via Claude Code).
- **Job text** — synthesized in the same style as each ATS's typical posting layout (Greenhouse "About the role / What you'll do" sections, Lever terser skills-list style, Workday formal structured bullets, etc.). The cached `text` is what the tailoring scorer consumes; `sourceUrl` is preserved for the extraction-stage testing track.

## Bias caveats

- Same-family bias: Opus generated, Haiku tailoring → not fully bias-broken. Mitigated by ~⅓ messy fixtures, but real anonymized samples would be the only true fix (out of scope for this pass; flagged as a follow-up risk in the design doc).
- ATS-style synthesis: each job description's style mirrors that ATS's typical layout, but the actual ATS-side parsing still needs to be tested against the real `sourceUrl` values (extraction stage, separate metric).
