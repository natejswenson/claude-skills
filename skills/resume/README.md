# resume (Claude Code skill)

A self-contained [Claude Code](https://claude.com/claude-code) skill that tailors a
résumé to a target job description and renders it as a themed PDF — invocable
as `/resume`. Reading, job extraction, and tailoring are **agent-native**: the
invoking Claude Code agent does that work directly, in-conversation, using its
own tools. There is no subprocess LLM call and no per-run API cost. Only PDF
rendering and deterministic content validation run as scripts.

You give it your résumé **once**. After that, a run needs nothing but a job
posting — paste a URL and you get a tailored PDF back.

There is **one** résumé structure and the look comes entirely from a CSS
**theme**. Two ship, and you can replace either or write your own.

## What it does

1. **Read** your résumé (`.pdf` / `.txt` / `.md` natively via `Read`; `.docx`
   via a small extraction shim) — **on the first run only**. The extracted text
   is stored at `~/.claude/resume/source-resume.txt` and reused from then on.
2. **Get the job** — give it a URL and it fetches the posting in one call.
   Workday, Greenhouse, Lever and Ashby are read through the JSON API their own
   pages call, so the company, title, location and req id come back as fields
   rather than guesses. Firecrawl and a plain fetch are the fallbacks; a pasted
   description works too.
3. **Tailor** — the agent rewrites bullets to lead with job-relevant framing,
   following `references/tailoring-rules.md`, never inventing facts. Output is
   schema-validated (zod) and re-checked by a deterministic guard (banned
   phrases, scope qualifiers, derived durations, invented numbers) with up to
   3 corrective retries.
4. **Render** — one semantic HTML résumé, styled by a theme, printed to PDF
   through headless Chromium.
5. **Pick a theme** — both shipped themes render in a single browser launch,
   so they are both ready before you're asked; no re-tailoring, no
   re-validation.

Output files carry the application, so nothing overwrites anything:
`nate-swenson-alteryx-ai-platform-engineer.pdf`.

## Your stored résumé

Supplied once, kept as plain text at `~/.claude/resume/source-resume.txt` —
outside the install dir, so it survives reinstalls and upgrades.

```bash
node scripts/profile.mjs --status          # is one stored, and how old?
node scripts/profile.mjs --show            # print it
node scripts/profile.mjs --save <file>     # store (--force to replace)
node scripts/profile.mjs --clear --force   # delete it
```

Just say *"update my résumé"*, *"what résumé do you have?"*, or *"forget my
résumé"* — the skill runs these for you, and confirms before replacing or
deleting anything. A replaced résumé is kept at `source-resume.txt.bak`.

**Plain text, not a parsed structure, is deliberate.** This file is the ground
truth the validator checks tailored content against — the thing that catches an
invented number or an inflated scope. Storing a parse instead would make the
*parse* the ground truth, and a fact mangled during extraction would become
unfalsifiable. For the same reason, storing **refuses** binary input: a raw
`.pdf` or `.docx` saved here would silently break fact-checking on every future
run, not just one.

New facts that aren't on the résumé — an open-source project, a certification —
belong *in* that file, added with your approval. Anything not in it gets flagged
as unsupported, which is the point.

## Themes

| Theme | Looks like | Use it when |
|---|---|---|
| **`press`** (default) | Editorial: warm paper, one signature accent, section labels in a left gutter, monogram stamp | A person will see it — a referral, a hiring manager, your portfolio |
| **`ats-plain`** | Single column, headings above their content, no colour | It's going through a job board or an applicant tracking system |

Both render the *same* résumé from the same markup. Only the stylesheet differs.

**Why two.** A résumé PDF is read by software before a person sees it, and the
layout that reads best to a human is not the one that reads best to a parser.
`press` puts each section heading in a left gutter, which a column-detecting
parser treats as its own column and separates from the section it labels.
`ats-plain` exists so you don't have to choose between looking good and being
parsed correctly — pick per application.

### Making a theme yours

A theme is one CSS file. Copy a shipped one and edit it; your copy wins over
the shipped theme of the same name and survives reinstalls:

```bash
mkdir -p ~/.claude/resume/themes
cp assets/themes/press.css ~/.claude/resume/themes/press.css
```

For a new palette, five variables at the top of `press.css` are the whole job:

```css
--paper: #F5F0E6;   /* page background */
--ink:   #181510;   /* primary text    */
--dim:   #6E675C;   /* secondary text  */
--sig:   #E8501F;   /* the ONE accent  */
--hair:  rgba(24, 21, 16, 0.18);
```

For a different layout, write the file from scratch against the documented
class structure. Theme resolution is **explicit path > `~/.claude/resume/themes/`
> shipped**, and an unknown theme *name* is an error rather than a silent
fallback to the default.

**[`references/theme-contract.md`](skills/resume/references/theme-contract.md)**
is the full guide: the markup you're styling, the optional sections, the
pagination rules, and four constraints that keep a theme readable by résumé
parsers (they're measured, not stylistic).

## Requirements

- **Node.js ≥ 22** (see `.nvmrc`).
- **Chromium**, installed once via `npx playwright install chromium`. Rendering
  is headless Chromium, which is what lets a theme be plain CSS. The skill
  tells you if it's missing.
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
ln -sfn "$PWD/claude-skills/skills/resume/skills/resume" ~/.claude/skills/resume
cd claude-skills/skills/resume/skills/resume
npm install
npx playwright install chromium
```

Then, in any Claude Code session, run `/resume` and follow the prompts.

This stays in place until the marketplace install path above is live-verified
end-to-end; it will be removed in a fast-follow once confirmed.

## Usage

In Claude Code:

```
/resume <resume-path> <job-url-or-text>     # first run: stores your résumé
/resume <job-url>                            # every run after that
```

Pass what you have; the skill asks for anything missing, one item at a time.
After tailoring it opens the PDF and offers a theme picker, ending when you
save your favorite.

There is no separate CLI entrypoint — `scripts/render.mjs` and
`scripts/validate.mjs` are internal steps the skill shells out to, not
user-facing commands (see `SKILL.md` for the exact invocations it runs).

## Development

```bash
npm test               # offline unit suite (no network, no LLM calls; launches Chromium)
node scripts/evals/run.mjs   # tailoring-quality eval harness — real cost + wall-clock
                              # time; see docs/plans/2026-07-08-resume-eval-harness-design.md
```

`npm test` includes a **text-extraction baseline** that renders real fixtures
in both themes and asserts the PDF is still readable by the software that reads
it first — section headings survive extraction, the contact email lands near
the top, bullet order holds. It is two-sided: a deliberately broken theme
fixture must make it fail, so the check can't rot into a tautology.

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
