---
name: bible-study
description: Create a researched one-page Bible study from a verse, passage, or chapter, using only the Bible and Christian sources. Use for "create a Bible study", "study John 3", or "make a Bible study handout". Includes writing date, historical context, meaning, related verses, discussion, application, and a shareable visual.
user_invocable: true
version: 0.1.0
---

# Bible study

Turn Scripture into a group study with careful research behind a readable single-page handout.
Announce: “I'm using the bible-study skill to research the passage and design your group handout.”

## The one rule

**Every historical or interpretive claim must be grounded in the Bible or an identified Christian source; never invent certainty where Christian sources disagree.**

## Runtime and prerequisites

Support both Claude Code (`/bible-study John 3`) and Codex (`$bible-study John 3`).
Resolve bundled files relative to this SKILL.md, never the user's current directory.
Use `scripts/bible-data.mjs` for all Scripture retrieval and the host’s web tools for commentary; map Read/Write/Bash to local tools.
No Claude CLI, account credentials, paid model, or external app is required.

Node 18+ handles validation and HTML rendering without dependencies. PDF/PNG export uses
Python 3 with Playwright and its Chromium browser. Use an available Python environment;
if absent, install in a local venv using `python3 -m venv .venv`, then
`.venv/bin/python -m pip install playwright` and `.venv/bin/python -m playwright install chromium`.
Do not silently deliver HTML as though PDF export succeeded.

<!-- press:runtime -->
In Claude Code, load `/press`; in Codex, load `$press`; then follow the shared PRESS terminal/UI contract from `brand/agent-ui.md`. Do not copy or override that contract here.
<!-- press:runtime -->

## Workflow

### 1. Resolve the passage

Honor the passage and preferences already supplied; never ask about anything in it
that is clear. Ask only if the reference is missing, invalid, or genuinely ambiguous.
“John 3” means the entire chapter, not John 3:16 or 1 John 3. A single verse needs
its surrounding paragraph and book context. Verify references in the selected Bible;
do not silently change books or invent nonexistent verses.

Default to an adult small group, a 45-minute meeting, and the public-domain World
English Bible for brief quotations. State those defaults once. Honor a requested
translation, audience, or Christian tradition. Otherwise use broadly Christian language,
attribute disputed interpretations, and do not portray one denomination as all Christians.

If this installation explicitly enables optional local memory, follow
[references/local-memory.md](references/local-memory.md) after resolving the passage,
before research. It supplies only format and duration preferences; missing or disabled
memory leaves the workflow unchanged. Never retain religious beliefs or study history.

### 2. Research before designing

Read [references/research.md](references/research.md) and the common publisher registry at
[references/sources.json](references/sources.json). Retrieve Scripture with the shared API
client before research; see [references/bible-api.md](references/bible-api.md). Use it for
the main passage, surrounding text, every cross-reference, and direct quotations. Do not
mix ad hoc Bible websites or translations into the same study. Retain the returned JSON
records, including full chapter context, translation/license and provenance. Read the text;
a successful fetch does not mark a source reviewed.

Start with BibleProject, Enduring Word, Insight for Living, and Bible.org for every study.
Use at least three relevant publishers from this set, with two detailed interpretive
sources where available. A supplemental Christian source needs identity verification and
an explicit reason such as a requested tradition, missing coverage, or an interpretive
alternative. Record it as `providerId: supplemental` with `supplementReason`; never silently
replace the common source set with random search results. This default set leans Protestant;
it is not a claim to represent all Christian traditions.

Read the full passage and its
surroundings, a book introduction, and at least three substantive Christian sources
from distinct publishers. Search within identified Christian sources; exclude secular
encyclopedias, anonymous forums, search snippets, and AI summaries as evidence.
Read sources rather than collecting URLs. Follow a Christian author's citations only
when the underlying source also meets this restriction. Never pad research to a quota;
if reliable Christian evidence is unavailable, report the gap and narrow the claim.

Separate four questions:
- **Writing:** when the containing book was composed; authorship/tradition, range and uncertainty.
- **Setting:** when events occur versus what surrounded composition; political, religious,
  literary, and cultural details only when relevant and supported.
- **Meaning:** explain the passage in its original context before applying it. Distinguish
  the Bible's words, historical inference, and Christian interpretation.
- **Connections:** select 3-4 related passages and explain each connection; read them too.

For disputed dating or a central theological reading, seek a second Christian perspective.
Do not invent dialogue, motives, exact dates, Greek definitions, or a consensus. Avoid
stereotypes about Jewish people or treating intra-Jewish Gospel disputes as claims about
all Jews. A verse is not permission to pressure group members into disclosing private matters.

### 3. Build the study bundle

Use [references/study-schema.md](references/study-schema.md) and the worked John 3 bundle
at `evals/input/john-3.json` as a shape example, not as content for a different passage.
Save to a user-selected directory or `reports/bible-study/<passage-slug>/study.json`.
Include source identity evidence, dates accessed, paraphrased support notes, registry
`providerId` values, and the fetched records in `scripture`. Each Bible source links its
API URL and canonical `scriptureReference`. Use returned translation metadata and verify
that quoted words occur in the cited verses.
Mark reviews true only after doing them. These attestations are human/model judgments,
not facts established by the validator.

Design a participant study guide, with most of the page devoted to working through
Scripture. Use three reading sections covering the passage, each with an observation
question, an interpretation question, a related-passage comparison exercise, and space
to write a note or verse. Begin with prayer and reading instructions; end with personal
application, a written weekly commitment and follow-up, and prayer. Use the 45-minute
sequence: begin 3, three reading/discussion sections of 11, respond/pray 9. Keep the
four research areas and a short attributed Scripture excerpt in a supporting sidebar.
Questions should send readers back to the text, welcome discovery, and avoid giving
the answer away. Keep interpretation summaries available for reflection after discussion. Cover the entire requested
passage. Keep a longer research record in the bundle; condense the page, not the research.
Quote sparingly, label the translation, follow its permissions, and never label a paraphrase
as a quotation. The selected translation must be identified even for paraphrase-only studies.

### 4. Validate and render

From the skill directory, passing absolute paths for user artifacts:

```bash
node scripts/bible-study.js validate --file /absolute/path/study.json
node scripts/bible-study.js render --file /absolute/path/study.json --out /absolute/path/output
python3 scripts/export.py --file /absolute/path/output/study.html --out /absolute/path/output
```

`validate` checks structure, citation links, source attestations and word budgets. It
cannot certify a publisher's Christianity or a claim's truth. Read and judge both.
`render` HTML-escapes user/source text and uses generated PRESS tokens in `assets/study.css`.
No network is used by either command; export blocks remote resources as well.

Read the resulting PNG, render the PDF using `pdftoppm`, and inspect the PDF page image.
Use `pdfinfo` to prove exactly one page. Check clipping, readable text, citation labels,
all section coverage, source hyperlinks, and usable writing space. Ensure the guide
can be followed by participants without a separate leader script. Fix overflow by editing content or layout;
never crop missing content or shrink it to unreadable type. Export has a mechanical
overflow guard but visual judgment remains necessary. Inspect at phone and print scale.

### 5. Deliver

Show the visual and provide actionable PDF, PNG and HTML links. Briefly name the passage,
translation and any material unresolved uncertainty. Offer revision for the group's
translation/tradition if useful. Do not email, post, or message the group without an
explicit request. Creating a shareable file does not authorize distribution.
After delivery, an explicit request to remember a format or duration correction may
use the optional memory reference; never capture from the study bundle automatically.

## Failures and recovery

- Bible API unavailable: use the recorded cache with `--offline`, or report the gap. Never
  silently switch providers, translations, or fabricate missing verses. Unsupported requested
  translations require an explicitly chosen supported translation or a separately implemented
  licensed provider; this version implements only Bible-API.com.
- Source unavailable: find another eligible Christian source; retain the failed-source
  note in research, not as a cited source you pretend to have read.
- Invalid or missing evidence: fix the research bundle; no bypass flag exists.
- Export dependency missing: report the exact missing dependency and retain HTML/bundle.
- More than one page or visual overflow: shorten and re-export before delivery.
- Never claim a result you did not observe. State which checks ran and any limitation.

## Deterministic and judgment split

Code validates the schema, resolves source IDs, escapes text, renders and detects overflow.
The model judges source eligibility and support, theology, chronology, question quality,
and visual readability. `skill-invariants.json` declares this split and the real-run baseline.

## Examples

- `/bible-study John 3` or `$bible-study John 3`: study all 36 verses, not only 3:16.
- “Create a Bible study on Psalm 23:4 for teenagers”: read Psalm 23 in context, adapt questions.
- “Make a Catholic Bible study on John 3:5 using NABRE”: use the requested tradition and
  translation, observe quotation permissions, and label the perspective.

## Maintainer verification

Run `npm test` for offline positive/negative research and rendering cases. The frozen
John 3 run re-renders reviewed data; it does not simulate fresh research or a model score.
Run the documented baseline refresh command only after a real reviewed run. New dates
and passages must receive new research; never reuse John 3's conclusions by substitution.
