# resume (Claude Code skill)

A self-contained [Claude Code](https://claude.com/claude-code) skill that tailors a
résumé to a target job description and renders a polished PDF — invocable as
`/resume`. Tailoring runs locally through the `claude` CLI on your
subscription: **no API key, no per-run cost.**

## What it does

1. **Parse** your résumé (PDF / DOCX / TXT / MD) to text.
2. **Get the job** — paste the text, or give a URL and a 5-tier extraction
   waterfall pulls the posting (ATS adapters → JSON-LD / OpenGraph / Readability
   → optional Firecrawl).
3. **Tailor** — an 11-rule optimizer prompt rewrites bullets to lead with
   job-relevant framing while never inventing facts. Output is schema-validated
   (zod) and re-checked by deterministic guards (banned phrases, scope
   qualifiers, derived durations, invented numbers) with one corrective retry.
4. **Render** — a tailored PDF in one of 7 templates (`modern`, `classic`,
   `technical`, `polished`, `timeline`, `editorial`, `spotlight`).
5. **Pick a style** — switch templates with an instant (~0.5s) re-render and a
   live preview; no re-tailoring.

## Requirements

- **Node.js ≥ 22** (see `.nvmrc`).
- An authenticated **Claude Code CLI** (`claude`) on your `PATH` — the skill
  shells out to your subscription session for the tailoring step. No
  `ANTHROPIC_API_KEY` is needed or used by default.

## Install

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

## Usage

In Claude Code:

```
/resume <resume-path> <job-url-or-text>
```

Pass what you have; the skill prompts for anything missing. After tailoring it
opens the PDF and offers a style picker, ending when you save your favorite.

You can also run the CLI directly:

```bash
node bin/resume.mjs <resume-path> <job-url-or-text> [flags]
```

| Flag | Description |
|------|-------------|
| `--pick` | Choose the résumé from a native file dialog (macOS) instead of a path |
| `--open` | Open the rendered PDF in your default viewer when done |
| `--render <json>` | Re-render an existing tailored JSON sidecar in a new `--template` (instant; skips tailoring) |
| `--template <name>` | `modern` (default) · `classic` · `technical` · `polished` · `timeline` · `editorial` · `spotlight` |
| `--out <dir>` | Output directory (default: `./onetap-out`) |
| `--model <name>` | LLM model (default: `haiku` — fastest on the subscription path) |
| `--pdf-only` | Write only the PDF (skip the JSON sidecar) |
| `--json` | Print the change summary as JSON |
| `-h, --help` | Show help |

Outputs land in `./onetap-out/` (git-ignored): the tailored PDF, a JSON sidecar
(the tailored résumé data, reusable with `--render`), and a printed before→after
table of every optimized and dropped bullet.

## How it runs

Tailoring is the only slow step (~1–2 minutes) and runs **once**; switching
templates afterward is a cheap local re-render. The skill streams live progress
while the model works, so it never looks hung. The model runs with extended
thinking disabled — the single biggest speedup on the subscription path.

## Development

```bash
npm test          # offline unit suite (no network, no paid LLM calls)
npm run eval      # scored eval of the non-deterministic tailoring (free on the
                  # subscription; --l3 adds an optional billed judge under a cap)
npm run render    # render the sample fixture across templates (layout checks)
```

## Versioning & releases

Semantic versioning. The version lives in `package.json` and `SKILL.md`
frontmatter; changes are recorded in `CHANGELOG.md`. Feature branches cut from
`dev` and merge back via PR. Releases go out as a `dev → master` PR: on merge,
`.github/workflows/release.yml` automatically tags `vN.M.P` (from
`package.json`) and publishes a GitHub Release with notes from `CHANGELOG.md`.

## License

[MIT](./LICENSE) © Nate Swenson
