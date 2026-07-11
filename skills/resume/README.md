# resume (Claude Code skill)

A self-contained [Claude Code](https://claude.com/claude-code) skill that tailors a
résumé to a target job description and renders a polished PDF — invocable as
`/resume`. Reading, job extraction, and tailoring are **agent-native**: the
invoking Claude Code agent does that work directly, in-conversation, using its
own tools. There is no subprocess LLM call and no per-run API cost. Only PDF
rendering and deterministic content validation run as scripts.

## What it does

1. **Read** your résumé (`.pdf` / `.txt` / `.md` natively via `Read`; `.docx`
   via a small extraction shim).
2. **Get the job** — paste the text, give a `.txt` path, or a URL (`WebFetch`
   first, with a documented fallback procedure — see
   `references/job-extraction-fallback.md` — if that fails).
3. **Tailor** — the agent rewrites bullets to lead with job-relevant framing,
   following `references/tailoring-rules.md`, never inventing facts. Output is
   schema-validated (zod) and re-checked by a deterministic guard (banned
   phrases, scope qualifiers, derived durations, invented numbers) with up to
   3 corrective retries.
4. **Render** — a tailored PDF in one of 7 templates: `modern`, `classic`,
   `technical`, `editorial` (ATS-safe, single-column) and `polished`,
   `timeline`, `spotlight` (presentation-only — visually distinctive but not
   guaranteed to parse cleanly through every applicant tracking system).
5. **Pick a style** — switch templates with an instant re-render and preview;
   no re-tailoring, no re-validation.

## Requirements

- **Node.js ≥ 22** (see `.nvmrc`).
- Claude Code itself — this skill has no standalone CLI. It only runs inside
  a Claude Code session, invoked via `/resume`.

## Install

```
/plugin marketplace add natejswenson/claude-skills
/plugin install resume@claude-skills
```

Then, in any Claude Code session, run `/resume` and follow the prompts.

### Manual install / fallback

This skill ships inside the [`claude-skills`](https://github.com/natejswenson/claude-skills)
monorepo. Clone the repo, symlink this skill into your skills directory, and
install its dependencies:

```bash
git clone https://github.com/natejswenson/claude-skills.git
ln -sfn "$PWD/claude-skills/skills/resume" ~/.claude/skills/resume
cd claude-skills/skills/resume
npm install
```

Then, in any Claude Code session, run `/resume` and follow the prompts.

This stays in place until the marketplace install path above is live-verified
end-to-end; it will be removed in a fast-follow once confirmed.

## Usage

In Claude Code:

```
/resume <resume-path> <job-url-or-text>
```

Pass what you have; the skill asks for anything missing, one item at a time.
After tailoring it opens the PDF and offers a style picker, ending when you
save your favorite.

There is no separate CLI entrypoint — `scripts/render.mjs` and
`scripts/validate.mjs` are internal steps the skill shells out to, not
user-facing commands (see `SKILL.md` for the exact invocations it runs).

## Development

```bash
npm test               # offline unit suite (no network, no LLM calls)
node scripts/evals/run.mjs   # tailoring-quality eval harness — real cost + wall-clock
                              # time; see docs/plans/2026-07-08-resume-eval-harness-design.md
```

The eval harness is deliberately **not** run in CI — it shells real `claude
-p` subprocess calls (10–90 minutes depending on fixture-set size) and, by
default, an optional LLM-judge pass against the paid Anthropic API (capped at
$2.00 via `BudgetGate`, `--skip-judge` to disable). It's a manual/on-demand
gate a maintainer runs and signs off on before a release, not a required
check.

## Versioning & releases

Semantic versioning. The version lives in `package.json` and `SKILL.md`
frontmatter; changes are recorded in `CHANGELOG.md`. This repo's branch model
is `feature/* → dev → main`; see the root `CLAUDE.md` for the full release
process (a `dev → main` PR auto-merges on green CI, and a release tag is cut
separately, on request, via `gh workflow run resume.yml --ref main`).

## License

[MIT](./LICENSE) © Nate Swenson
