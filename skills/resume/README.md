# resume (Claude Code skill)

A self-contained [Claude Code](https://claude.com/claude-code) skill that tailors a
résumé to a target job description and renders a polished PDF — invocable as
`/resume`. Reading, job extraction, and tailoring run **agent-native**: the
invoking agent does the work directly, in-conversation, using its own tools.
Only PDF rendering and a deterministic content check run as code. No
subprocess LLM call, no API key, no per-run cost.

## What it does

1. **Read** your résumé (`.pdf`, `.txt`, or `.md`) with the agent's own `Read`
   tool.
2. **Get the job** — paste the text, give a path to a `.txt` file, or give a
   URL (`WebFetch`, with a markdown-file fallback procedure for blocked or
   short-content sites).
3. **Tailor** — the agent rewrites bullets to lead with job-relevant framing,
   following the rules in `references/tailoring-rules.md` (never invent
   facts). Output is written as schema-validated JSON and re-checked by
   `scripts/validate.mjs` (banned phrases, scope qualifiers, derived
   durations, invented numbers) — fix and re-run until clean.
4. **Render** — a tailored PDF in one of 7 templates (`modern`, `classic`,
   `technical`, `polished`, `timeline`, `editorial`, `spotlight`).
5. **Pick a style** — switch templates with an instant re-render and a live
   preview; no re-tailoring, no re-validation.

## Requirements

- **Node.js ≥ 22** (see `.nvmrc`).
- A Claude Code agent to run the skill in — there is no standalone CLI.
- Optional: a [Firecrawl](https://firecrawl.dev) API key
  (`FIRECRAWL_API_KEY`) to unlock automatic extraction on sites `WebFetch`
  can't reach directly (Indeed, Glassdoor, ZipRecruiter). Without it, paste
  the job description text instead.

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

Outputs land in `~/resume-out/` by default: the tailored PDF and a JSON
sidecar (the tailored résumé data, reusable across template re-renders).

### LinkedIn

LinkedIn job URLs are rejected by default — a deliberate ToS/legal-risk
policy, not a technical limitation. Paste the job description text instead,
or set `RESUME_ALLOW_LINKEDIN=1` to opt into routing LinkedIn URLs through
the Firecrawl fallback like any other blocked host.

## How it runs

Tailoring happens in-conversation as the agent reasons over your résumé and
the job description — there's no multi-minute subprocess call to wait on.
Switching templates afterward is a cheap (~1s) local re-render via
`scripts/render.mjs`.

## Development

```bash
npm test              # offline unit suite: schema/content validation,
                       # PDF rendering across all 7 templates, a template
                       # line-spacing regression guard
npm run validate       # run the deterministic content validator standalone
npm run render         # render a tailored JSON sidecar to PDF standalone
```

`docs/security/prompt-injection-fixtures/` is a manual verification
checklist (not an automated test) — periodically run the skill against each
fixture's adversarial text and confirm the agent doesn't comply with
embedded instructions.

## Versioning & releases

Semantic versioning. The version lives in `package.json` and `SKILL.md`
frontmatter; changes are recorded in `CHANGELOG.md`. Feature branches cut from
`dev` and merge back via PR. Releases go out as a `dev → main` PR: on merge,
`.github/workflows/release.yml` automatically tags `vN.M.P` (from
`package.json`) and publishes a GitHub Release with notes from `CHANGELOG.md`.

## License

[MIT](./LICENSE) © Nate Swenson
