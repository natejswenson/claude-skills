# onetapresume (skill)

A self-contained [Claude Code](https://claude.com/claude-code) skill that tailors a
résumé to a target job description and renders a polished PDF — invocable as
`/onetapresume`.

It is a faithful port of the [OneTap Resume](https://onetapcv.com) web pipeline
(parse → extract job → LLM tailoring → multi-template PDF), with the web
monetization shell (Stripe paywall, Turnstile, rate-limiting, recovery flow)
removed. The tailoring runs locally through the `claude` CLI on your
subscription — no API key required, no per-run cost.

## What it does

1. **Parse** your résumé (PDF / DOCX / TXT / MD) to text.
2. **Get the job** — paste the text, or give a URL and a 5-tier extraction
   waterfall pulls the posting (ATS adapters → JSON-LD / OpenGraph / Readability
   → optional Firecrawl).
3. **Tailor** — an 11-rule optimizer prompt rewrites bullets to lead with
   job-relevant framing while never inventing facts. Output is schema-validated
   (zod) with one corrective retry.
4. **Render** — a tailored PDF in one of 7 templates (`modern`, `classic`,
   `technical`, `polished`, `timeline`, `editorial`, `spotlight`).
5. **Diff** — a readable summary of which bullets were optimized vs dropped.

## Usage

```
/onetapresume <resume-path> <job-url-or-text> [--template modern] [--pdf-only]
```

Smart invocation: pass what you have, and the skill prompts for anything
missing. See `SKILL.md` for the full contract.

## Development

```bash
npm install
npm test          # offline unit suite (no network, no paid LLM calls)
npm run eval      # scored eval harness for the non-deterministic tailoring
```

## Versioning

Semantic versioning. The skill version lives in `SKILL.md` frontmatter and
`package.json`; see `CHANGELOG.md`. Feature branches cut from `dev`, merge back
to `dev` via PR; releases are PR'd `dev → master` and tagged `vN.M.P`.
