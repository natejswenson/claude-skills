/**
 * The README contract — one house style, checked rather than hoped for.
 *
 * Before this, ten skills shipped ten READMEs: 28 to 279 lines, no two section
 * orders alike, and three different H1 forms (`# forge (Claude Code skill)`,
 * `# ghostwriter`, `# smith (Claude Code skill)`). A reader arriving from the
 * marketplace had to re-learn where "how do I install this" lives on every
 * single one.
 *
 * The shape is **fixed head, free tail, fixed foot**. The head answers the four
 * questions a stranger has — why would I install this, what is in it, how do I
 * start, when does it fire — in that order. The foot is where a maintainer
 * looks. Everything between is the skill's own business, which is why devlog can
 * carry a configuration reference and github-stats can carry nothing at all and
 * both still conform.
 *
 * Enforcing order rather than merely presence is deliberate: a README with the
 * right sections in an arbitrary order is exactly as unscannable as one missing
 * them, and "present somewhere in the file" is the check that lets a house style
 * rot one PR at a time.
 *
 * See `references/readme.md` for the prose spec and the PRESS component each
 * part maps to.
 */

/** The head, in order. The masthead and H1 are checked separately — they are lines, not sections. */
export const HEAD = ['Why install this', 'What you get', 'Quick start', 'Triggers', 'Requirements'];

/** The foot, in order, and last. */
export const FOOT = ['Development', 'Changelog', 'License'];

const problem = (id, detail, fix) => ({ id, detail, fix });

/**
 * Every `## ` heading, in document order, **ignoring fenced code blocks**.
 *
 * Not a nicety: devlog's README documents its entry format by showing one, and
 * that example contains `## Shipped`, `## Gotchas` and `## Changelog` at column
 * zero inside a fence. Counting those makes the document's real last section
 * look like something else entirely, and the foot check fails on a README that
 * is correct.
 */
const sections = (text) => {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && /^## /.test(line)) out.push(line.slice(3).trim());
  }
  return out;
};

/**
 * The lines of the body, with the generated masthead region removed. Every
 * structural check runs against this: the region's own contents are press's
 * business and must never be what satisfies a contract about hand-written prose.
 */
function withoutMasthead(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('>>> press:masthead'));
  if (start === -1) return { lines, hasMasthead: false, mastheadAt: -1 };
  const end = lines.findIndex((l, i) => i > start && l.includes('<<< press:masthead'));
  if (end === -1) return { lines, hasMasthead: false, mastheadAt: -1 };
  return {
    lines: [...lines.slice(0, start), ...lines.slice(end + 1)],
    hasMasthead: true,
    mastheadAt: start,
  };
}

/**
 * Grade one README. Returns `{ok, problems}` — never throws, because an absent
 * or malformed README is a finding to report, not an exception to crash on.
 */
export function gradeReadme(text, name) {
  const problems = [];
  if (!text) {
    return { ok: false, problems: [problem('missing', 'no README.md', 'every plugin root ships one')] };
  }

  const raw = text.split('\n');
  const { lines, hasMasthead, mastheadAt } = withoutMasthead(text);

  // --- the head: H1, masthead, standfirst, pull quote ----------------------

  if (raw[0] !== `# ${name}`) {
    problems.push(
      problem(
        'h1',
        `line 1 is ${JSON.stringify(raw[0] ?? '')}, not "# ${name}"`,
        "the H1 is the bare skill name — press's masthead anchors on `^# <name>$`, so a decorated title silently detaches the region",
      ),
    );
  }

  if (!hasMasthead) {
    problems.push(
      problem(
        'masthead',
        'no press:masthead region',
        'run `press emit --init --target <name>-readme`; the brand is generated, never typed',
      ),
    );
  } else if (raw.slice(1, mastheadAt).some((l) => l.trim() !== '')) {
    // Blank lines are fine and are what `press emit --init` writes; content is
    // not. The eyebrow belongs against the headline, and anything wedged
    // between them reads as a stray note above the brand rule.
    problems.push(
      problem(
        'masthead-position',
        `content sits between the H1 and the masthead (line ${mastheadAt + 1})`,
        'nothing but blank lines may separate the headline from its eyebrow',
      ),
    );
  }

  // The first two content lines after the head furniture: the standfirst (one
  // italic line, the setup) and the pull quote (the skill's one rule).
  const body = lines.slice(1).filter((l) => l.trim() !== '');
  if (!/^\*[^*].*\*$/.test(body[0] ?? '')) {
    problems.push(
      problem(
        'standfirst',
        `expected an italic one-line standfirst, found ${JSON.stringify((body[0] ?? '').slice(0, 60))}`,
        'PRESS `.stand` — one italic line saying what the skill is for, before any heading',
      ),
    );
  }
  if (!/^> \*\*/.test(body[1] ?? '')) {
    problems.push(
      problem(
        'pull-quote',
        `expected "> **the one rule**", found ${JSON.stringify((body[1] ?? '').slice(0, 60))}`,
        "PRESS `.pull` — the skill's one rule as a blockquote; a skill with no stated rule has not decided what it refuses to do",
      ),
    );
  }

  // --- section order -------------------------------------------------------

  const found = sections(lines.join('\n'));

  const headActual = found.filter((s) => HEAD.includes(s));
  if (headActual.join(' | ') !== HEAD.join(' | ')) {
    const missing = HEAD.filter((s) => !found.includes(s));
    problems.push(
      problem(
        'head-order',
        missing.length
          ? `missing: ${missing.map((s) => `## ${s}`).join(', ')}`
          : `out of order: ${headActual.join(' → ')}`,
        `the head is exactly: ${HEAD.map((s) => `## ${s}`).join(' → ')}`,
      ),
    );
  }

  const footActual = found.slice(-FOOT.length);
  if (footActual.join(' | ') !== FOOT.join(' | ')) {
    const missing = FOOT.filter((s) => !found.includes(s));
    problems.push(
      problem(
        'foot-order',
        missing.length
          ? `missing: ${missing.map((s) => `## ${s}`).join(', ')}`
          : `the last sections are ${footActual.join(' → ')}`,
        `every README closes on: ${FOOT.map((s) => `## ${s}`).join(' → ')}`,
      ),
    );
  }

  // --- the two sections with a required form -------------------------------
  //
  // Both exist to be *shown*, not described. A "What you get" written as prose
  // is the paragraph everyone skips; a "Quick start" with no command in it is
  // the section that made the reader open the SKILL.md instead.

  // Fence-aware for the same reason `sections` is: a `## ` inside an example
  // block would end the section early and hide the table or fence that follows.
  const bodyOf = (heading) => {
    const at = lines.findIndex((l) => l === `## ${heading}`);
    if (at === -1) return null;
    const out = [];
    let fenced = false;
    for (const line of lines.slice(at + 1)) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^## /.test(line)) break;
      out.push(line);
    }
    return out;
  };

  const inventory = bodyOf('What you get');
  if (inventory && !inventory.some((l) => /^\|.*\|$/.test(l.trim()))) {
    problems.push(
      problem(
        'inventory-table',
        '## What you get contains no table',
        'PRESS data table — `| Path | What it provides |`, so a reader can see the tree without cloning it',
      ),
    );
  }

  const quickstart = bodyOf('Quick start');
  if (quickstart && !quickstart.some((l) => l.startsWith('```'))) {
    problems.push(
      problem(
        'quickstart-block',
        '## Quick start contains no code block',
        'PRESS `.term` — real commands, copyable; prose describing a command is not a quick start',
      ),
    );
  }

  return { ok: problems.length === 0, problems };
}

/** One-line summary for a report table. */
export function summarizeReadme(grade) {
  return grade.ok
    ? 'head, foot and masthead conform'
    : grade.problems.map((p) => `${p.id}: ${p.detail}`).join('; ');
}
