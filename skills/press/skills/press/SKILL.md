---
name: press
description: The one brand system for everything produced in Claude — design tokens, the visual laws, the run-presentation contract, and the universal voice core. Use when composing or restyling any artifact (report, résumé, card, cover, PDF, HTML page, chart), when asked about brand colors, fonts, the accent law or "the PRESS look", when adding a new skill that renders anything, or when a brand value needs to change everywhere at once. Also handles "check the brand is in sync", "why do my colors differ", and onboarding a new consumer repo.
user_invocable: true
version: 0.5.1
---

# /press — the brand system

You are running the **press** skill. PRESS is the warm-paper editorial brand
every artifact shares: a morning brief, a city profile, a budget report, a
résumé, a LinkedIn card, a dev-log cover, and the site all read as issues of one
publication.

**Announce at start:** "I'm using the press skill for the brand."

> All commands below run from the directory containing this `SKILL.md` (the
> skill's install dir, `$SKILL_DIR`). Resolve it once and `cd` there first. When
> working in another repo, pass `--repo <path>`.

## The one rule

**Never write a brand value into a file by hand.** Not a hex, not a font stack,
not the monogram. Every consumer gets its values *generated* into a marked
region, and CI fails if any of them drifts. Copying a value is how this brand
ended up in eight hand-ported copies with five different names for the same
orange, which is the problem this skill exists to end.

If a consumer needs a color that doesn't exist yet, add it to
`brand/tokens.json` and re-emit. Never invent one locally.

## What's here

| File | Is |
|---|---|
| `brand/tokens.json` | **The** source of truth: colors, font stacks, identity, limits |
| `brand/laws.md` | Why there are so few values: the accent law, structure, the three voices, the tracking ceiling |
| `brand/components.md` | The shared component vocabulary — masthead, standfirst, big stat, ledger, duel, terminal, table |
| `brand/agent-ui.md` | How a skill's run should read in the chat transcript |
| `brand/voice-core.md` | The copy rules that hold for every artifact |
| `targets.json` | Every place the brand is written down |

## Composing something new

1. **Read `brand/laws.md` first, then `brand/components.md`.** They are short.
   Composing without them produces something that uses the right colors and
   still looks like a different product.
2. **Pick the components the content needs**, not a template. PRESS is a brand
   system, not a template — two artifacts should never share a skeleton just
   because they share a brand.
3. **Get the values from the CLI, never from memory:**
   ```bash
   node bin/press.js tokens --format css     # a :root block
   node bin/press.js tokens --format json    # raw values
   node bin/press.js tokens --format md      # the palette as prose
   ```
4. **Lint before showing the user:**
   ```bash
   node bin/press.js lint <file…> [--accent-cap 2]
   ```
   Findings are mechanical brand violations, not style opinions. Fix them.
5. **Show the rendered artifact, not a description of it.** Per
   `brand/agent-ui.md`, a visual claim without the image in the transcript is
   not a result.

## Checking every consumer is in sync

```bash
node bin/press.js check                 # this repo
node bin/press.js check --repo ../budget
node bin/press.js doctor                # the whole registry, present or not
```

`check` fails on three things, not one: a region whose bytes drifted, a region
that has **gone missing** from a file that should have one, and a run that
resolved **zero** targets. The last two matter most — a checker that verifies
nothing reports "all clean", which is exactly how a gate turns decorative.

On failure it prints the diff and the exact `press emit` command that fixes it.
Run that; do not hand-edit the region.

## How a change reaches every product

There are **two different questions**, and conflating them is what leaves a
consumer silently stale.

| | Question | Answered by | Runs |
|---|---|---|---|
| **Integrity** | does this region match the press version this repo adopted? | `press check` | inside each consumer, against a **pinned** version |
| **Freshness** | has this repo adopted the **current** brand? | `press propagate` | from press, against a consumer's checkout |

**A pinned check can never answer the second question** — it passes forever
against the version it was pinned to. That is not a hypothetical: this skill's
own site consumer sat two releases behind with entirely green CI.

**Consumers pin on purpose.** A mutable `@latest` in a repo that auto-deploys to
production is a supply-chain hole, and a reproducible check is the only kind
worth gating a merge on. So freshness is **pushed from here** rather than polled
by each consumer:

```bash
node bin/press.js propagate --repo ../budget --dry-run   # is it behind?
node bin/press.js propagate --repo ../budget             # re-emit + bump its pin
```

`propagate` re-emits every region it resolves, bumps any
`@natjswenson/press@<version>` pin it finds in that repo's workflows, and reports
what moved. The caller turns that into a pull request, so nothing lands
unreviewed — but nobody has to *remember*.

Two rules keep it from becoming noise or a false negative:

- **Content decides, not the version receipt.** A region written by 0.1.0 that
  is still byte-correct under 0.3.0 is *current*. Opening a PR for it would be
  noise.
- **A stale pin alone is not "behind".** It changes no shipped artifact, so it
  is bumped silently and never triggers a PR on its own.

`.github/workflows/press-propagate.yml` runs this on every release and weekly,
opening a PR in each consumer repo whose bytes actually moved.

## Changing a brand value

This is the one operation that touches every product, so do it deliberately.

1. Edit `brand/tokens.json`. One value, with a reason.
2. `node bin/press.js emit --dry-run` and read what would change.
3. `node bin/press.js emit`, then run the affected skills' own test suites —
   a token change must not break anyone's baseline.
4. Re-render one real artifact per affected medium and **look at it**.
5. Bump the version and add a `CHANGELOG.md` entry in the same change.

**Repos outside this one need no manual step.** Releasing the version bump fires
`press-propagate.yml`, which opens a PR in every consumer whose bytes actually
moved. To see it early, dry-run against a local checkout:

```bash
node bin/press.js propagate --repo ../budget --dry-run
```

## Onboarding a new consumer

1. Add a target to `targets.json`: `id`, `repo`, `path`, `region`, `syntax`
   (`python` | `css` | `md`), `emitter`, and `params`.
2. Choose the emitter:

   | Emitter | Produces |
   |---|---|
   | `python-theme` | the token dict plus the shared deep-merge loader |
   | `css-vars` | a custom-property block, with per-consumer aliases |
   | `md-palette` | the palette as a prose bullet list |
   | `markdown-block` | one of the brand docs, inlined into a SKILL.md |
   | `json` | raw values |

3. **Pick the font profile for its rendering engine.** `params.font_profile` is
   `browser` by default. Anything going through **fontconfig — WeasyPrint above
   all — must say `fontconfig`**, because it walks the fallback chain for real
   and the browser chain resolves headlines to Helvetica Neue Heavy Condensed.
   Survey the consumer's current stacks before you assume.
4. Add an `init` anchor naming the first and last line of the hand-written block
   the region takes over, so the duplicate is **swallowed**, not left behind.
5. `node bin/press.js emit --target <id> --init`
6. Add a `press check` step to that repo's CI, **pinned to an exact version**:
   `npx -y @natjswenson/press@0.5.0 check --repo .`. Never write a bare
   `npx @natjswenson/press` — with no version reference at all, npx silently
   prefers a stale global install over the registry, which cost this repo a
   release once already. An exact pin also keeps a mutable dependency out of a
   repo that auto-deploys to production; `propagate` bumps it for you.
7. If its GitHub repo name differs from the `repo` field (budget lives at
   `local-budget`), add `"github": "<name>"` so propagation can find it.

**Survey before you emit.** Diff the consumer's real values against the token set
first: adopting the site turned up a `'JetBrains Mono'` fallback and three alpha
tints the tokens could not express, and emitting blindly would have silently
dropped them. Widen the tokens to the union; never narrow a consumer.

**Aliases are deliberate.** The résumé keeps `--sig`, the site keeps `--fg`. The
names stay idiomatic to their medium; only the values are shared. Renaming
across three repos would be churn for no gain.

**Never generate a whole file.** The region owns the token block; the consumer
owns everything else — its 250-line stylesheet, its poster geometry, its
personal avatar footer. A whole-file sync clobbered exactly that once already.

## Adopting the prose contracts

`brand/agent-ui.md` and `brand/voice-core.md` are spliced **into** a consuming
SKILL.md as `markdown-block` regions rather than referenced. A consuming skill is
a separately installed plugin and cannot reliably read this skill's files at
runtime, so build-time splicing is the only mechanism that actually works.

A medium's own voice layers on top and **wins on conflict** — ghostwriter's
learned profile and devlog's release-note shape stay where they are. The core is
what applies when nothing more specific does.

## What press does not decide

Layout and composition (the medium's business), chart color validation (the
`dataviz` skill), and any voice learned from the user's own writing. PRESS sets
the floor everything shares, not the whole of anything.
