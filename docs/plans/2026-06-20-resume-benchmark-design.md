---
ticket: "#N/A"
title: "Resume Generator Benchmark — accuracy + speed on real resume × real jobs"
date: "2026-06-20"
source: "design"
---

# Resume Generator Benchmark

A CLI benchmark that measures the **accuracy** and **speed** of the
`resume` skill's tailoring pipeline, using Nate's **real résumé PDF** as the
canonical input and a curated set of **real job postings** spanning his target
role distribution (DevOps / Platform / SRE / AI-LLMOps). Its scoring is
**function-deterministic** (re-scoring a fixed ResumeJSON is bit-identical) but
**end-to-end variable** (a fresh run re-tailors via a non-temperature-pinned LLM,
so scores move run-to-run) — see Decisions for the two-level distinction.

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
metric, **two $0 subscription-CLI LLM judges** (tailoring-fit + grounding, both
soft/corroborating), and a discrimination check.

## Decisions (resolved with user)

- **LLM-as-judge: YES, but routed through the local Claude Code CLI** (`claude -p`),
  not the billed Anthropic API. Confirmed feasible: the subscription `claude -p`
  path runs schema-validated structured output at $0. The G1 judge
  is **net-new code** (`judge-cli.mjs`) that defines its own JSON schema and invokes
  `claude -p --json-schema`; it does NOT reuse the billed
  `scorer/judge.mjs` signature (no `apiKey`, no `budgetGate`). `judge-cli.mjs`
  **spawns its own `claude -p` child directly** (it does NOT reuse `CLIAdapter`)
  so it can enforce its own **90s timeout that KILLs the child** (SIGTERM, then
  SIGKILL) on expiry and fail-open promptly — `CLIAdapter` exposes no
  cancellation hook and has a hard-coded 600s ceiling, so wrapping a `CLIAdapter`
  call in an `AbortController` would NOT interrupt the spawned child. Cost = $0; the
  only price is wall-clock (~20–40s per judge call).
- **All LLM-judge signals are non-deterministic and corroborating, never hard
  gates.** `claude -p` has no temperature pin (`CLIAdapter` sets none), so BOTH
  CLI judges — G1 tailoring-fit AND the grounding/no-fabrication judge — vary
  run-to-run. **Two distinct levels of reproducibility** (do not conflate them):
  - **Function-deterministic:** the scoring functions (`checkRules`,
    `keywordCoverage`, `scoreEval` → G2/G3/G4/fitness) are **bit-identical given a
    FIXED saved ResumeJSON**. Re-scoring a committed baseline ResumeJSON reproduces
    exactly.
  - **End-to-end variable:** a fresh `npm run benchmark` **re-tailors via the LLM**
    (`tailorResume` → `claude -p`, no temperature pin), so the same résumé × job can
    produce a **different ResumeJSON and therefore different coverage / G2–G4 /
    fitness / `checkRules` violations across runs.** The benchmark does NOT claim
    end-to-end reproducibility.
  The two CLI judges are
  reported as approximate signals, surfaced for human review, and never used as
  the sole basis for any gate, the discrimination check, or a non-zero exit. The
  **only HARD accuracy gates** are the function-deterministic ones: the **HARD
  partition of `checkRules`** (violations must be 0 — see Metrics) and the existing
  G3 floor — evaluated on whatever ResumeJSON the fresh run produced.
- **Inputs are cached, not live.** Real postings are sourced once (web search) and
  cached as text fixtures so the benchmark **inputs** are fixed and regression-safe
  (this fixes the inputs only — the LLM tailoring step still varies run-to-run; see
  the two reproducibility levels above). Live URL extraction has its own separate
  fixture track (`scripts/fixtures/extract/`) and would add network flakiness on top
  of the existing LLM variance.

## Architecture

```
scripts/
├── fixtures/benchmark/
│   ├── jobs.mjs            NEW — ~7 real postings (incl. 2 controls), cached text (existing fixture shape)
│   ├── resume.pdf          NEW — copy of Nate_Swenson_Resume (12).pdf  [gitignored]
│   └── README.md           NEW — provenance + how fixtures were sourced
├── scorer/
│   └── judge-cli.mjs       NEW — G1 tailoring-fit judge via subscription CLI ($0)
└── eval/
    ├── benchmark.mjs       NEW — the harness (timing + scoring + report)
    └── keyword-coverage.mjs NEW — deterministic JD requirement coverage
```

Reused as-is: `lib/pipeline.ts` (`loadResumeText`, `tailorResume`, `trimJobText`),
`scripts/scorer/index.mjs` (`scoreEval` for G2/G3/G4 + fitness). `lib/llm/cli.ts`
(`CLIAdapter`) is reused **only for the tailoring path** (via `LLM_MODE=cli`); the
**judge path does NOT use `CLIAdapter`** — `judge-cli.mjs` spawns its own bounded
`claude -p` child (90s timeout-with-kill) because `CLIAdapter` has no cancellation
hook and a 600s ceiling.

Reused, wrapped with a net-new severity partition: `scripts/eval/rules.mjs`
(`checkRules` — hard-rule compliance, NOT a fabrication detector; the benchmark
splits its rules into HARD vs REPORTED rather than gating on the whole result;
see Metrics).

## Data flow (per job)

```
real PDF ──loadResumeText──▶ raw text ──(15k cap)──▶ normalize ──▶ resumeText (cached once)
       (unpdf/pdf.js, mergePages)   (slice to 15_000 chars     (collapse whitespace, strip
                                  │   BEFORE returning —         soft hyphens, de-hyphenate
                                  │   lib/pipeline.ts:83)        line-break splits)
                                  │  (anchor sanity check: non-empty + fixture anchors)
cached RAW JD text ──┬──────────────────────────────────▶ tailorResume (trims internally)
                     └──trimJobText(raw)──▶ trimmedJD (first 6000 chars, same input the LLM saw)
                                  │
                                  ▼
                         [t_tailor] tailorResume(resumeText, RAW jobText)  ← LLM, ~1–2min, $0
                                  │ ResumeJSON                  (trims internally; not pre-trimmed)
        ┌────────────────┬────────┼──────────────────┬─────────────────────┐
        ▼                ▼        ▼                  ▼                     ▼
[t_render]      checkRules     grounding        scoreEval(resume)   keywordCoverage(
renderPdf       (HARD/REPORTED CLI judge        → G2/G3/G4/fitness    resume, trimmedJD)
(optional)      partition)     ($0, soft)       [t_judge] judgeCli → G1 ($0, approx)
                → violations   → suspected      both judges: soft, fail-open, corroborating
                  (HARD subset   fabrication      (NEVER hard-fail, NEVER abort run)
                   gates; rest
                   REPORTED)
```

`benchmark.mjs` passes the **RAW cached JD** to `tailorResume` (which calls
`trimJobText` **internally**, at `lib/pipeline.ts:145`) and **separately** computes
`trimJobText(raw)` for `keywordCoverage`. So coverage scores against exactly "the
same input the LLM saw," and the JD is never double-trimmed in a way that would
shift boilerplate-strip boundaries (trimming the trimmed text could re-fire
boilerplate patterns at new offsets).

The résumé is parsed **once** (it's the same input for every job); only the job
text and downstream scoring vary per case. Extraction uses `unpdf`/`pdf.js`
(`mergePages: true`) — NOT `pdftotext`.

**15k-char résumé cap (disclosed).** `loadResumeText` slices the parsed text to
**`MAX_RESUME_CHARS = 15_000`** (`lib/pipeline.ts:83`) **before** it returns — so
the cap is applied **before** normalization, `checkRules`, the grounding judge, and
the anchor check. This is the same text the LLM sees (`tailorResume` is fed the
same capped string), so scoring the truncated text against itself is
**self-consistent**: the correct reference for "did the model fabricate beyond its
input" is exactly the 15k-truncated, normalized text the LLM saw — **not** the full
PDF. The caveat: a résumé **>15k chars** silently drops its trailing experience
before anything sees it, which can weaken the anchor check (an anchor past 15k would
be missing) and JD-coverage (later roles' keywords never reach the model). For the
**default fixture résumé (small, well under 15k) this is a non-issue**; it matters
only for an over-15k `--resume` override. Checking fabrication against the
**extracted** text is correct (the LLM only ever saw extracted text), but
extraction artifacts (split tokens, mangled "X years") could otherwise trip the
hard substring checks. The benchmark **normalizes the extracted text once after
`loadResumeText` returns** (a second, additive normalization pass over the
already-parser-normalized text — `parseResumeFile` inside `loadResumeText` has
already done \r\n→\n, NBSP→space, trim; this pass adds collapse whitespace, strip
soft hyphens, de-hyphenate line-break splits) before it reaches `checkRules` or
the grounding judge, so extraction artifacts never
manufacture a false violation — see the Faithfulness mitigations in Metrics.
Normalization fixes *extraction* artifacts, but it does **not** fix
*model-output-format* mismatches: `checkRules` is therefore **wrapped with a
net-new severity partition** (HARD vs REPORTED rules — see Metrics), not gated on
its whole result, because some of its rules (notably `R9_optimized_role_unknown`)
fire on format/style choices, not fabrication.

## Metrics

### Speed (free, every run)
Per job, wall-clock via `performance.now()`:
- `t_parse` — résumé parse (measured once; same input)
- `t_tailor` — LLM tailoring **[headline]**
- `t_judge` — CLI judge (when enabled)
- `t_render` — PDF render (when `--render`)
- `t_total`

**Reporting (default, single run per job).** Report each job's per-phase
wall-clock individually, plus a **suite total** and a **mean** across jobs. We do
**NOT** report p50/p95 across jobs: a single run per job conflates the different
job prompts (different JD lengths/content) with run-to-run latency variance, so a
cross-job percentile is not a reproducible latency distribution — it's
input-dependent. Single-run cross-job timing is a coarse "did anything blow up"
signal only. A "speed regression" is meaningful only when it exceeds run-to-run
noise, which `--repeat` characterizes.

**`--repeat N` (real latency distribution, opt-in).** Re-runs **one fixed job**
N times and reports a true per-phase distribution (**min / median / max**) for
the tailoring step. The first run is discarded as **warmup** — it absorbs
process/spawn cold-start and server-side warmup variance, NOT prompt-cache warming
(the CLI subscription path has no cross-call prompt cache; `cli.ts` documents that
"every call re-processes the full prompt cold") — so the recommended floor is
**N ≥ 4 (≥ 3 measured points)** for a
non-degenerate median. N = 3 leaves only 2 measured points — a crude 2-point
spread with a degenerate median, acceptable only as a rough sanity check. This is
the only mode in which a latency percentile/median is a reproducible number.

### Accuracy (per job)
| Metric | Source | Cost | Determinism | Gate |
|---|---|---|---|---|
| **Structural rule compliance** (HARD subset: `R6_summary_phrase` banned phrases, `R9_optimized_noop` unchanged optimized bullet) | `checkRules(resume, {sourceText})`, HARD partition | $0 | function-deterministic | **HARD: HARD-partition violations must be 0** |
| **Source/format-sensitive rule signals** (REPORTED subset: `R9_optimized_role_unknown`, `scope_qualifier`, `R6_derived_years`) | `checkRules(resume, {sourceText})`, REPORTED partition | $0 | function-deterministic | **REPORTED only — surfaced, NEVER a non-zero exit** |
| **JD coverage** | `keywordCoverage(resume, trimmedJD)` — weak proxy | $0 | function-deterministic (varies end-to-end via LLM-tailored input) | soft — reported; floor configurable but **NEVER causes a non-zero exit** (only flags a `--json` regression) |
| **G2 word usage / G3 not-AI / G4 writing / fitness** | `scoreEval` (L1+L2) | $0 | function-deterministic (varies end-to-end via LLM-tailored input) | G3 hard floor 40 (existing) |
| **G1 tailoring-fit** | `judge-cli.mjs` (subscription `claude -p`) | $0 | **non-deterministic** (CLI judge, no temp pin) | **soft** (reported, corroborating only; default floor 50 never exits non-zero) |
| **Grounding** (no-fabrication signal) | `judge-cli.mjs` grounding pass — see below | $0 | **non-deterministic** (CLI judge, no temp pin) | **soft** (reported, corroborating only; surfaces suspected-ungrounded claims for human review) |

**"Function-deterministic" ≠ end-to-end reproducible.** The Determinism column above
means **bit-identical given a FIXED ResumeJSON** (re-scoring a saved baseline
reproduces exactly). It does **not** mean run-to-run stable: every fresh
`npm run benchmark` re-tailors via the non-temperature-pinned LLM, so the input
ResumeJSON — and hence coverage / G2–G4 / fitness / `checkRules` violations — can
differ across runs. See the two-level reproducibility note under Decisions.

The **only HARD accuracy gates** (non-zero exit) are: the **HARD partition of
`checkRules`** (HARD-partition violations = 0) and the existing G3 floor. The
REPORTED partition of `checkRules` is surfaced but never exits non-zero. **No
LLM-judge signal — G1 or grounding — is ever a hard gate or causes a non-zero
exit.** (Both `checkRules` partitions are function-deterministic given a fixed
ResumeJSON, but the ResumeJSON itself is LLM-generated and varies run-to-run — see
the two-level reproducibility note under Decisions.)

**One-time calibration (REQUIRED before trusting the hard gate).** Before the
HARD partition is trusted as a gate, run the full pipeline **once** on the default
fixture résumé + a known-clean job and confirm `checkRules` returns **0 violations
on that known-clean tailoring**. If a rule fires on a *format/style* choice rather
than fabrication — e.g. `R9_optimized_role_unknown` firing because Haiku emitted
`optimizedBullets[].role` as a job *title* instead of the exact `company` string
(`role` is an unconstrained `z.string()` in `schemas/resume.ts`, so this is a
model-output-format mismatch, NOT an extraction artifact normalization can fix) —
that rule is **format-sensitive, not a fabrication signal**, and belongs in the
REPORTED partition. This calibration is what justifies the partition below.

**Hard-rule compliance (`checkRules`), reframed honestly + partitioned.** This is
NOT a fabrication detector. It checks a narrow set of black-and-white invariants,
which calibration splits into two partitions:
- **HARD (genuinely structural; non-zero exit):** `R6_summary_phrase` (banned
  connective phrases — pure output-string check) and `R9_optimized_noop` (an
  optimized bullet identical to its original — pure output-self-consistency check).
  These cannot be tripped by source format or model naming style.
- **REPORTED (source/format-sensitive; surfaced, never exits):**
  `R9_optimized_role_unknown` (fires when `role` ≠ an exact `company` string — a
  model-output-format quirk), `scope_qualifier` and `R6_derived_years` (source-gated
  substring checks against lossy extracted text). These are surfaced for human
  review but do **not** fail the run, because a fire here is as likely a format/style
  quirk as a real problem.

Its own header explicitly delegates real fabrication detection
(invented employers / metrics / technologies) to the L1/L2/L3 scorer. It is **one
gate among several, not THE faithfulness guarantee.** (This supersedes the earlier
"keep the whole `checkRules` result HARD + normalize upstream" approach, which the
tightened review showed was insufficient: normalization cannot fix
`R9_optimized_role_unknown`, a format mismatch rather than an extraction artifact.)

**Grounding (a SOFT, corroborating no-fabrication signal).** A **$0 CLI judge
pass** (`judge-cli.mjs`, a second prompt) asking *"Does any
`optimizedBullet.rewritten` or `summary` claim assert a fact (employer, metric,
title, technology, duration) not supported by the SOURCE résumé text?"* The judge
returns a list of **suspected** ungrounded claims. This list is **reported for
human review — it is NOT a hard gate and NEVER causes a non-zero exit.** Rationale
for a CLI judge over a deterministic grounded-substring check: rewrites
legitimately paraphrase, so naive substring grounding produces heavy false
positives — and the source is the (lossy) extracted text, which makes exact
matching noisier still. But that same non-determinism is exactly why it cannot be
a hard gate: `claude -p` has no temperature pin (`lib/llm/cli.ts` sets none), so
the same résumé can yield different ungrounded lists run-to-run. Making it a hard
fail would reintroduce the determinism problem the benchmark exists to avoid.
Therefore grounding is treated identically to G1: **soft, corroborating,
advisory.** The function-deterministic faithfulness gate is carried by the **HARD
partition of `checkRules`** (with its REPORTED partition and the grounding list
surfaced for manual review); the grounding judge only adds a second pair of eyes
the human can act on.

The grounding judge consumes the **same normalized extracted source text** the
hard-rule checks do (see Faithfulness mitigations (a) — whitespace collapsed, soft
hyphens stripped, line-break splits de-hyphenated). That source reference is the
**15k-truncated, normalized text the LLM saw** (`loadResumeText` caps at
`MAX_RESUME_CHARS = 15_000` before returning — see Data flow), **not** the full
PDF — which is the correct reference for fabrication-vs-input. Normalization removes
the "5 year s" class of artifact before scoring, but the source is still the (lossy)
extracted text, so residual extraction noise plus the judge's run-to-run variance
remain reasons it is advisory, not a hard gate.

**Faithfulness mitigations against extraction artifacts.** `checkRules`'
source-gated substring checks (scope qualifiers, "X years") run against the lossy
`unpdf`/`pdf.js` extraction, so split tokens / reordered columns can cause FALSE
violations (e.g. a real "5 years" that extraction split into "5 year s" would
manufacture a derived-years violation). The benchmark removes this *extraction*
risk **upstream**, before any text reaches `checkRules`. Note this does NOT make
`checkRules` safe to gate on whole-result: `R9_optimized_role_unknown` fires on a
model **output-format** mismatch (role naming) that no source normalization can
fix. So `checkRules` is **reused, wrapped with a net-new severity partition
calibrated so format quirks don't fail the run** (HARD vs REPORTED — see "reframed
honestly + partitioned" above), not gated as a whole. Mitigations:

- (a) **Normalize the extracted source text once, after `loadResumeText`
  returns** (a second, additive pass over the already-parser-normalized text),
  **before it ever reaches `checkRules`** (and before the grounding judge).
  Collapse runs of
  whitespace to a single space, strip soft hyphens, and de-hyphenate line-break
  splits (join `word-\nword` → `word word` / `wordword` as appropriate). This
  removes the "5 year s" / "8 yea rs" class of artifact at the source, so the
  source-gated `R6_derived_years` and `scope_qualifier` checks never fire on an
  *extraction* artifact in the first place. This handles extraction noise only — it
  does NOT make the whole `checkRules` result safe to gate on, since
  `R9_optimized_role_unknown` fires on a model output-format quirk no normalization
  can fix. The **severity partition** (above) is what keeps the run from failing on
  format quirks: only `R6_summary_phrase` and `R9_optimized_noop` are HARD; the rest
  are REPORTED. (The existing `run-eval.mjs` harness gates on the whole `checkRules`
  result; the benchmark deliberately diverges via this calibrated partition.)
- (b) **One-time anchor sanity check** at parse time: assert the (normalized,
  15k-capped) extracted résumé text is non-empty and contains expected anchors;
  abort the run with a clear error if extraction is degraded, so we never score
  against garbage text. Because the résumé is parsed once, before the per-job loop,
  this abort fires at parse time and so precedes all per-job scoring / mock-skip /
  discrimination logic — it is a pre-flight guard, not a per-job gate. (Because the check runs on the post-15k-cap text, anchors
  must fall within the first 15k chars — a non-issue for the small default fixture.) **The anchors are fixture-coupled** (Nate's name + a known employer) and
  are therefore **only enforced for the default fixture résumé**. `--resume` is a
  swappable flag; pointing it at a different résumé would falsely trip these
  hard-coded anchors, so for a user-supplied `--resume` the anchor check is
  **skipped (or the only universal check — non-empty extracted text — applies)**.
  Anchors are derived from / coupled to the default fixture, not the swappable
  input.

**JD coverage is a weak proxy — read alongside faithfulness.** It measures how
many JD nouns the tailored output echoes, NOT whether the candidate is qualified;
it is **gameable by keyword-stuffing**. High coverage + a grounding/fabrication
failure is a FAILURE, not a pass. Coverage runs against the **trimmed** JD
(`trimJobText` → first 6000 chars after boilerplate strip) — the same input the
LLM saw — so long postings aren't unfairly penalized for keywords the model never
received.

### Discrimination check (suite-level) — directional sanity check, not a proof
With ≥ 2 low-fit **control** jobs (e.g. Frontend Engineer + a second off-target
role), the controls must land **below the treatment median**. The **primary signal
is JD-coverage** — the one (function-deterministic) metric that tracks
fit *to this specific JD* — and it alone is the basis for the verdict. Note its
function-determinism is on a FIXED ResumeJSON only: coverage is computed on the
**LLM-tailored** résumé, so it **inherits the tailoring step's run-to-run
variance** end-to-end, reinforcing that this is a coarse directional indicator. The
non-deterministic **G1 judge corroborates** (when `--judge-samples K` with K>1 is
set, each per-job G1 call is averaged over K samples to reduce its run-to-run
variance), but is never the sole basis. This shows the metric *separates* good
tailoring from bad: a benchmark where everything scores ~70 measures nothing.
Reported as PASS/FAIL with the gap. **The verdict output carries a one-line
caveat** that its primary signal (JD-coverage) is the doc's
weakest/gameable metric **and inherits LLM run-to-run variance**, so the verdict is
a **coarse directional indicator**, not a precise score.

**Why not `fitness`?** `fitness` (function-deterministic) contributes almost no
*separating* power for tailoring-fit here, so it is **not** the discrimination
signal. With the
billed L3 judge off, `scoreEval` sets g1 to a **constant 50**
(`scorer/index.mjs`), and `fitness = 0.35·g1 + 0.15·g2 + 0.35·g3 + 0.15·g4`. So
≈35% of fitness is a fixed constant (0.35·50 = 17.5 for *every* job), ≈30% (G2+G4)
measures lexicon/writing style, and G3 measures not-AI stylometry — **none of
which tracks fit to this JD**. `fitness` therefore guards
style / not-AI quality, not tailoring fit, and is unsuited as a discriminator.

**Honest limitation.** The strong tailoring-fit signal (G1) is non-deterministic,
and the only *function-deterministic* tailoring-fit signal is JD-coverage — which
the doc itself calls **weak and gameable** (keyword-stuffable) and which still
**inherits the LLM tailoring step's run-to-run variance end-to-end**. So this check
is a **coarse directional indicator**, not a precise one: a function-deterministic
tailoring-fit metric beyond coverage is a **v1 follow-up** (not invented here).

This is a **DIRECTIONAL SANITY CHECK, explicitly NOT statistical proof** — with
N=1 résumé and a handful of controls it has no statistical power. Broader
validation (multiple résumés × multiple controls, significance testing) is **out
of scope for v1, flagged as a follow-up.**

**In `--mock` mode this check is SKIPPED** (see Invariants): `tailorResume`
returns a fixed fixture regardless of job, so every job — control and treatment —
produces the identical résumé and the separation is meaningless.

## Job fixture set (~7 real postings, sourced by Claude)

| # | Role | Fit | Tests |
|---|---|---|---|
| 1 | Senior DevOps Engineer | high | baseline close-match |
| 2 | Platform Engineer | high | platform/IaC emphasis |
| 3 | Site Reliability Engineer | high | SRE/observability surfacing |
| 4 | AI/LLMOps or AI Agent Engineer | high | **does tailoring surface his Claude-agent work?** |
| 5 | Staff/Principal Platform Engineer | stretch | seniority-stretch behavior |
| 6 | Frontend Engineer (control) | **low** | discrimination — must score below treatment median |
| 7 | Second off-target control (e.g. UX Designer / Sales Eng) | **low** | second control — gives the directional check ≥ 2 low-fit points |

Each fixture uses the existing shape (`id, archetype, ats, title, company,
sourceUrl, text`) with `archetype: "nate-devops"`. Real `sourceUrl` preserved;
`text` is the cached posting body the scorer consumes.

## API Surface

```js
// scripts/scorer/judge-cli.mjs
//   NET-NEW code. Does NOT reuse scorer/judge.mjs's signature — no apiKey, no
//   budgetGate. Defines its OWN JSON schema and spawns its OWN `claude -p` child
//   (NOT CLIAdapter) with --json-schema. Non-deterministic (claude -p has no
//   temperature pin), so BOTH judges are corroborating only. `samples` averages
//   over K judge calls on a single résumé to shrink judge variance (costs K×
//   wall-clock; K=1 default). This is DISTINCT from the CLI's --repeat latency
//   flag (which re-runs one job for timing and does not touch the judges).
//
//   BOTH judges are FAIL-OPEN. Each judge owns its child process and enforces a
//   90s timeout that KILLs the child (SIGTERM, then SIGKILL after a short grace)
//   on expiry — so a hung judge is actively terminated at 90s, not merely
//   abandoned, and never waits on a 600s ceiling. (This is why the judge does NOT
//   reuse CLIAdapter: CLIAdapter exposes no AbortSignal and hard-codes a 600s
//   timeout, so an AbortController wrapping a CLIAdapter call could not interrupt
//   the spawned child.) The judge's own child-spawn THROWS on spawn failure,
//   non-zero exit, the 90s kill, or unparseable/missing structured_output. On ANY
//   such error — or an empty/malformed parse — the judge returns a NEUTRAL/
//   BLANK result with a reason and the suite CONTINUES. There is NO retry (keeps
//   the 15–25 min wall-clock bounded). Because both judges are soft/corroborating,
//   a judge failure never fails the suite and never aborts it — it just yields a
//   neutral signal flagged "judge_failed" in the report.
//
//   G1 schema (for --json-schema):
//     { requirements: [ { requirement: string,
//                         status: "well"|"weakly"|"unaddressed" } ] }
//   score = round((100*well + 50*weakly) / requirements.length)
//   On error/unparseable → { score: 50, breakdown: { reason: "judge_failed" } }.
export async function judgeTailoringFitCli(
  { resume: object, jobText: string, model?: string, samples?: number }
): Promise<{ score: number, breakdown: object, runs?: number }>;

//   Grounding (no-fabrication) judge — same adapter, distinct schema:
//     { ungrounded: [ { claim: string, source: "summary"|"bullet",
//                       reason: string } ] }
//   SOFT/advisory: a non-empty `ungrounded` list is SURFACED for human review,
//   NOT a hard fail and NEVER a non-zero exit. `ok` is purely informational
//   (true iff the list is empty); no caller gates on it.
//   On error/unparseable → { ok: true, ungrounded: [], reason: "judge_failed" }
//   (fail-open: an empty list, run continues).
export async function judgeGroundingCli(
  { resume: object, sourceText: string, model?: string }
): Promise<{ ok: boolean, ungrounded: object[], reason?: string }>;

// scripts/eval/keyword-coverage.mjs
//   Deterministic JD-noun echo proxy (gameable; weak signal — see Metrics).
//   Caller passes the TRIMMED JD (trimJobText output, first 6000 chars) so
//   coverage matches the input the LLM actually saw. It measures coverage across
//   the tailored résumé's live rendered content — `resume.experience[].bullets`
//   plus `resume.summary` — NOT the `optimizedBullets` diff record.
export function keywordCoverage(
  resume: object, trimmedJobText: string
): { coverage: number, matched: string[], missed: string[] };

// scripts/eval/benchmark.mjs  (CLI entry; npm run benchmark)
//   Flags: --resume <path> (default fixtures/benchmark/resume.pdf)
//          --jobs <id,id>   (default: all fixtures)
//          --judge          (enable CLI G1 + grounding judges; $0, soft/
//                            corroborating only, fail-open; adds wall-clock)
//          --judge-samples K (avg each per-job G1 judge call over K samples to
//                            shrink judge variance for the corroborating G1
//                            signal; K=1 default; costs K× judge wall-clock.
//                            DISTINCT from --repeat)
//          --repeat N       (re-run ONE fixed job N times → tailoring latency
//                            min/median/max; first run discarded as warmup.
//                            Latency only — does NOT run the judges)
//          --render         (also render PDF + time it)
//          --json           (machine-readable report)
//          --mock           (MOCK_LLM=1 PLUMBING check only — see Invariants;
//                            accuracy + discrimination NOT asserted)
```

## Invariants

**Checkable by inspection:**
- **Tailoring** runs on the subscription because `benchmark.mjs` sets
  `process.env.LLM_MODE = "cli"` before importing the pipeline (so
  `getLLMClient()` memoizes the `CLIAdapter` — see `lib/llm/index.ts`).
- **The CLI judges** do NOT depend on `LLM_MODE`. They run on the subscription by
  **spawning their own `claude -p` child directly** (NOT `CLIAdapter`, NOT
  `getLLMClient()`), so they share no state with the tailoring client and can
  enforce a 90s timeout-with-kill that `CLIAdapter` cannot offer. No
  `ANTHROPIC_API_KEY` is read on any benchmark path, and the one billed path
  (`scorer/judge.mjs`) is never imported here.
- **Both CLI judges are fail-open and self-bounded.** Each judge spawns and owns
  its own `claude -p` child with a **90s timeout that KILLs the child** (SIGTERM →
  SIGKILL) on expiry — so a hung judge is terminated at 90s, not abandoned, and
  never waits on a 600s ceiling. On a throw (spawn fail / non-zero exit / 90s kill
  / unparseable output) or empty parse, the judge returns a neutral/blank result
  (G1 → score 50 reason `judge_failed`; grounding → empty list reason
  `judge_failed`) and the run CONTINUES. No retry. Because both judges are
  soft/corroborating, a judge failure NEVER fails the suite and NEVER aborts it.
- The résumé is parsed exactly once per suite run.
- Every timing is captured with a monotonic clock (`performance.now()`), not
  `Date.now()`.

**`--mock` is a WIRING / PLUMBING check ONLY.** `tailorResume` under `MOCK_LLM=1`
returns a FIXED fixture regardless of job (verified in `lib/pipeline.ts`).
Therefore mock exercises **only** timing instrumentation, report rendering, and
the scoring code paths — accuracy and discrimination numbers in mock are
**meaningless and MUST NOT be asserted**. In mock mode:
- the **discrimination check is SKIPPED** (not run), and
- **accuracy floors are SKIPPED** (G3 floor, coverage floor, and the HARD-partition
  `checkRules` gate do not fail the run). (The CLI judges are soft anyway and never
  fail the run in any mode.)
The run still exits 0 and prints the full report, proving the plumbing.

**Requires tests:**
- MOCK mode (`--mock`) completes with $0 and no `claude` spawn, exercising the
  full report path (plumbing check, CI-safe). Asserts the report renders and
  timing fields are populated — does NOT assert any accuracy/discrimination value.
- The **HARD-partition `checkRules` gate** fails the run (non-zero exit) when a
  **HARD-partition** violation (`R6_summary_phrase` or `R9_optimized_noop`) is found
  against the real résumé source — driven by a **real or synthetic-but-varied
  fixture**, NOT `MOCK_LLM` (mock can't produce a per-job violation). **Conversely,
  a REPORTED-only violation** (`R9_optimized_role_unknown`, `scope_qualifier`,
  `R6_derived_years`) is surfaced but **exits 0** — assert both directions. (The
  grounding judge is soft and is NOT part of this gate — a non-empty ungrounded list
  is reported, never exits non-zero.)
- **One-time calibration** (above) is run once on the default fixture and confirms
  the known-clean tailoring yields 0 `checkRules` violations; any format-sensitive
  rule that fires there is REPORTED, not HARD.
- **Both CLI judges fail open**: a forced child-spawn throw (e.g. stubbed spawn
  failure or the 90s timeout-kill firing) yields a neutral G1 (50, `judge_failed`) /
  empty grounding list (`judge_failed`) and the suite still completes and exits 0 —
  the judge failure neither fails nor aborts the run.
- Discrimination check correctly flags when controls do NOT land below the
  treatment median — driven by **synthetic-but-varied** per-job scores (or a real
  run), NOT `MOCK_LLM` (mock yields identical résumés for every job, so it can
  never exercise separation).

## Bias caveats

Mirrors `scripts/fixtures/perf/README.md`'s bias section — same risks apply here:

- **Same-family self-preference.** Tailoring runs on **Haiku** (CLI) and the G1 +
  grounding judges run on **Claude** (same model family via `claude -p`). A model
  judging its own family's output inflates G1. **Mitigation:** the
  function-deterministic metrics (HARD-partition `checkRules`, keyword coverage,
  G2/G3, fitness) drive every hard gate, and the JD-coverage signal (not the judges)
  is the primary basis of the discrimination check; the G1 and grounding judges are
  **soft/corroborating only**. (Coverage is itself weak/gameable AND inherits LLM
  run-to-run variance — see the Discrimination limitation.) Residual risk
  acknowledged: even the grounding judge is same-family, so its false-negative
  rate on subtle fabrication is unquantified — another reason it is advisory and
  the HARD partition of `checkRules` carries the hard faithfulness gate.
- **N=1 résumé.** A single real résumé (Nate's) drives the whole suite. The
  discrimination check is directional, not statistical (see Metrics). True
  bias-breaking needs multiple real, anonymized résumés — **out of scope for v1,
  flagged as a follow-up risk.**

## Cost & time

- **Tailoring:** $0 (subscription CLI). **Judges (G1 + grounding):** $0
  (subscription CLI).
- **Wall-clock, full 7-job run with `--judge`:** ~7 × (1–2 min tailor + 2 × 20–40s
  judge) ≈ **15–25 min**. Without `--judge`: ~7–14 min. `--mock`: seconds.
  *Note:* the tailoring path (`CLIAdapter`) has a 600s timeout, but the judges do
  NOT use `CLIAdapter`. Each judge spawns its own `claude -p` child with a **90s
  timeout that KILLs the child** (SIGTERM → SIGKILL) on expiry, so a hung judge is
  terminated and fails open at 90s — the worst-case judge tail is bounded to ~90s,
  not the 600s `CLIAdapter` ceiling.
  `--repeat N` adds (N−1) × tailor time for the one repeated job. `--judge-samples
  K` (K>1) multiplies the per-job **G1 judge** wall-clock by K (grounding judge
  unaffected), so a 7-job `--judge --judge-samples 3` run adds ~7 × 2 × (20–40s).
- No billed API calls anywhere. The existing billed judge (`scorer/judge.mjs`)
  is left untouched and unused by this harness.

## Resolved decisions

1. **Real résumé PDF:** RESOLVED — copy to `scripts/fixtures/benchmark/resume.pdf`
   and **gitignore it**. Benchmark is reproducible locally; the personal résumé
   never ships in a public release. `--resume` defaults to this path.
2. **Job count:** 7 (covers the distribution + **2 low-fit controls** so the
   discrimination check has ≥ 2 control points). Easy to add later; each adds
   ~1–2 min/run.

## Acceptance criteria

- `npm run benchmark -- --mock` runs in seconds, $0, prints the full report. It is
  a **plumbing check**: accuracy floors and the discrimination check are SKIPPED
  and no accuracy/discrimination value is asserted.
- `npm run benchmark` runs the real pipeline over all fixtures, prints per-job
  accuracy + per-phase timing + suite total/mean + discrimination verdict
  (directional; primary signal = JD-coverage, G1 corroborating),
  exits non-zero ONLY on a function-deterministic violation **on a TREATMENT
  job**: a **HARD-partition `checkRules`** violation (`R6_summary_phrase` or
  `R9_optimized_noop`) or a G3-floor breach. **Control jobs are NOT exit-affecting**
  — they are deliberately bad-fit reference points for the discrimination check, so
  they are expected to score low (forcing a strong-mismatch tailoring produces
  formulaic, low-G3 output); failing the run on a control would conflate
  "intentionally off-target control" with "generator broken". A control's gate
  status is still computed and reported (marked `•`, "not gating"), just not
  exit-affecting (see `suiteHardFail` in `benchmark-lib.mjs`) — except a control
  ERROR (a pipeline crash on the control input) DOES fail the suite, since a crash
  is real generator breakage, not an intentionally-low score. Only a control
  gate-MISS (G3 floor / HARD rule) is non-gating. REPORTED `checkRules`
  rules and all LLM-judge signals are surfaced but never cause a non-zero exit.
  **One-time calibration** on the default fixture must have confirmed 0 violations
  on a known-clean tailoring before the gate is trusted. (No cross-job p50/p95 —
  that's only produced by `--repeat`.)
- `npm run benchmark -- --judge` adds the $0 CLI G1 and grounding judges. Both are
  **soft/corroborating and fail-open**: they enrich the report (and surface
  suspected-ungrounded claims for human review) but never fail or abort the run.
- `npm run benchmark -- --repeat N` produces a real tailoring-latency
  min/median/max for one fixed job (first run discarded as warmup).
- `--json` emits a machine-readable report for regression tracking (see below).
- A new `scripts/benchmark.test.mjs` (MOCK plumbing + synthetic-fixture
  discrimination/gate tests, $0) is wired into `npm test`.

**Regression-tracking semantics (`--json`).** "Regression tracking" means: a
**committed baseline JSON** records only the **function-deterministic** fields per
job — HARD-partition + REPORTED `checkRules` violation counts (HARD expected 0), G3
/ fitness / G2 scores, and JD coverage.
**Excluded from regression comparison as noisy:** all timing (compared only with a
tolerance band if at all — see the per-job-timing rationale above) and BOTH CLI
judges (G1 and grounding), which are non-deterministic and informational —
including the grounding judge's **`ok`** field, which is informational-only (it is
NOT a deterministic boolean and no caller gates on it; see API Surface).

**Two reproducibility levels, two regression paths (do not over-trust the
`--json` baseline of a fresh run).** Because a fresh `npm run benchmark` re-tailors
via the non-temperature-pinned LLM, a floor crossing or a newly-appearing violation
on a fresh run **can be benign LLM run-to-run variance, not a real regression**.
- **Recommended (function-deterministic) regression path: RE-SCORE a SAVED baseline
  ResumeJSON.** The benchmark also commits the **tailored ResumeJSON** alongside the
  baseline scores; re-running the scoring functions over that *fixed* JSON is
  bit-identical, so any score/violation delta there is a **true code regression** in
  the scorers/rules, not model drift.
- **Fresh-run comparison (end-to-end variable): treat as a SOFT signal.** A
  hard-floor crossing (G3 < 40, or a newly-appearing HARD `checkRules` violation) on
  a single fresh run is **not** automatically a regression: require it to **reproduce
  across K runs** (or fall outside a tolerance band) before it counts as a regression
  or is trusted as the cause of a non-zero exit. (The fresh run's HARD gate still
  exits non-zero for *that run* — that is correct fail-closed behavior — but a CI
  "regression" claim must clear the K-run / tolerance bar.)

A **regression** is concretely defined as either (a) a function-deterministic metric
crossing its floor — G3 < 40 (this one ALSO exits non-zero on the run, it's a hard
gate), or a coverage drop below the configured soft floor (a `--json`-flagged
regression **only** — the coverage floor NEVER causes a non-zero exit), or (b) a
HARD-partition `checkRules` violation appearing where the baseline had none (also a
hard gate → non-zero exit) — **subject to the reproduce-across-K / re-score-baseline
qualification above** so benign LLM variance is not logged as a regression. A
newly-appearing **REPORTED** `checkRules` violation is surfaced in `--json` but is
**not** a regression trigger and never exits non-zero. In short: G3 and
HARD-`checkRules` regressions are hard gates *and* `--json` regressions (best
confirmed by re-scoring the saved baseline ResumeJSON); a coverage-floor regression
is a `--json` flag with no effect on exit code. The judge signals and raw latencies
are emitted in `--json` for human inspection but are NOT regression triggers.
