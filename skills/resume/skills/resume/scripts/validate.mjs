#!/usr/bin/env node
/**
 * validate.mjs — deterministic checks on a tailored résumé JSON before it's
 * rendered: (1) a zod structural gate, then (2) content-truthfulness checks
 * (banned phrases, scope qualifiers not in source, derived durations,
 * invented numbers, bullet accounting, and all-roles-preserved).
 *
 * This is a deliberate backstop against the tailoring agent's own
 * self-grading blind spots — exact string/number matching is something
 * deterministic code does reliably and an LLM self-check does not. It has
 * caught real bugs before (a no-op-bullet bookkeeping error). The structural
 * gate runs first: skipping it would let a malformed JSON sail through and
 * fail later with an unhelpful error deep inside render.mjs.
 *
 * Plain JS, no TSX loader needed — the schema and validation logic are
 * self-contained here rather than imported from a separate schema/lib file,
 * per the "one code home" root-cleanliness decision.
 *
 * Usage:
 *   node scripts/validate.mjs --json <path> --resume <path-or-text>
 *
 * Exit 0 and prints "✓ clean" if both the structural gate and content checks
 * pass. Exit 1 with a list of issues otherwise — the agent should fix its
 * tailored JSON and re-run until clean.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const HELP = `validate — check a tailored résumé JSON for schema and content violations

Usage:
  node scripts/validate.mjs --json <path> --resume <path-or-text>

Flags:
  --json <path>          path to the tailored résumé JSON to check
  --resume <path|text>    path to the original résumé text, or the literal text itself
  -h, --help              show this help`;

// ---------------------------------------------------------------------------
// Schema (the runnable contract; the JSON shape is also described in prose to
// the agent in references/tailoring-rules.md — this is the executable half).
// ---------------------------------------------------------------------------

const OptimizedBullet = z.object({
  original: z.string(),
  rewritten: z.string(),
  role: z.string(),
});

export const ResumeJSON = z.object({
  name: z.string().min(1),
  contact: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.string()).default([]),
  }),
  summary: z.string(),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
  education: z.array(
    z.object({
      degree: z.string(),
      school: z.string(),
      year: z.string().optional(),
      details: z.string().optional(),
    }),
  ),
  droppedBullets: z.array(z.string()).default([]),
  optimizedBullets: z.array(OptimizedBullet).default([]),
});

// ---------------------------------------------------------------------------
// Content-truthfulness checks.
// ---------------------------------------------------------------------------

/** Lowercase + collapse whitespace for tolerant substring matching. */
function norm(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Banned connective phrases that must never appear in the summary. */
export const BANNED_SUMMARY_PHRASES = [
  "expertise in",
  "deep expertise",
  "experienced in",
  "experienced with",
  "hands-on experience",
  "hands on experience",
  "hands-on in",
  "strong background",
  "strong experience",
  "strong foundation",
  "proven track record",
  "proven ability",
  "proven experience",
  "demonstrated ability",
  "demonstrated experience",
  "passionate",
  "seasoned",
  "results-driven",
  "results driven",
  "cutting-edge",
  "cutting edge",
  "world-class",
  "world class",
  "enterprise-grade",
  "enterprise grade",
];

/** Scope qualifiers that are only allowed if present in the source. */
const SCOPE_QUALIFIERS = [
  "at scale",
  "large-scale",
  "large scale",
  "enterprise-grade",
  "enterprise grade",
  "high-throughput",
  "high throughput",
  "world-class",
  "world class",
  "mission-critical",
  "multi-region",
  "petabyte",
];

/** All free text the agent produced (summary + every bullet + skills). */
function outputText(resume) {
  return [
    resume.summary,
    ...resume.experience.flatMap((e) => e.bullets),
    ...resume.optimizedBullets.map((b) => b.rewritten),
    ...resume.skills,
  ].join("\n");
}

/**
 * Drop `optimizedBullets` entries that record no actual change (rewritten ===
 * original after trim). Such entries are a bookkeeping error — the bullet was
 * effectively KEPT, not optimized — and they pollute the change summary shown
 * to the user. Deterministic; the bullet itself stays in `experience[].bullets`
 * untouched. Returns the same object when nothing changes.
 */
export function dropNoopOptimizedBullets(resume) {
  const cleaned = resume.optimizedBullets.filter(
    (b) => b.original.trim() !== b.rewritten.trim(),
  );
  return cleaned.length === resume.optimizedBullets.length
    ? resume
    : { ...resume, optimizedBullets: cleaned };
}

// ---------------------------------------------------------------------------
// Experience-section extraction (for scoping the R3 bullet-accounting check).
// ---------------------------------------------------------------------------

/**
 * Header detection is an ALLOW-LIST of known header phrase shapes, not an
 * exclusion heuristic. Three prior rounds tried to reject non-headers by
 * looking for sentence-like features (whole-document scope, then character-
 * length caps, then word-count/trailing-punctuation caps) — and each round
 * surfaced a new false positive, because natural language is too varied to
 * exhaustively blocklist. The 4th round's break: a short, unpunctuated bullet
 * like "- Led 5 years experience" (or, in an ALL-CAPS résumé, "- LED 5 YEARS
 * EXPERIENCE") satisfies every exclusion gate (short, no trailing
 * punctuation, ≤5 words) while still not being a header.
 *
 * Instead, a line counts as a header if and only if, after trimming and
 * collapsing internal whitespace, it case-insensitively EQUALS one of a
 * small fixed set of known header phrases below — optionally followed by a
 * trailing colon and/or a trailing "(...)" parenthetical (e.g. "Experience:",
 * "EXPERIENCE (2015-Present)", "Relevant Experience (10 Years)") — and
 * nothing else. Any additional word anywhere on the line (a verb, an object,
 * a number, "Led", "Strong") means the line is not equal to any listed
 * phrase, which rules out the whole class of false positives structurally
 * rather than by trying to detect "is this a sentence".
 */

/** Experience-family header phrases. Used to locate the START of the scoped
 * region. A SECOND (sibling) experience-family header encountered later —
 * e.g. "VOLUNTEER EXPERIENCE" or "ADDITIONAL EXPERIENCE" following "WORK
 * EXPERIENCE" — is NOT a scope boundary: per R3/R4 in
 * references/tailoring-rules.md, ALL experience-type roles (main job
 * history AND volunteer/additional/leadership roles) fold into the SAME
 * single experience[] output array and must be counted TOGETHER. Such a
 * header line is skipped over (it has no bullet marker, so it never
 * contributes to the bullet count either way) rather than ending the
 * region. */
const EXPERIENCE_HEADER_PHRASES = [
  "experience",
  "work experience",
  "professional experience",
  "relevant experience",
  "relevant work experience",
  "employment history",
  "work history",
  "career history",
  "clinical experience",
  "classroom experience",
  "volunteer experience",
  "additional experience",
  "leadership experience",
];

/** Other-section header phrases. These close a scoped experience region but
 * never open one — an "EDUCATION" or "SKILLS" line is never itself the start
 * of the experience section.
 *
 * Accepted limitation: this heuristic runs on raw freeform text with no
 * structural signal, so a bare generic word used as a role-internal
 * subheading (e.g. "Projects" under a specific job) — rare in practice —
 * can be misread as a top-level boundary and truncate the scope early. This
 * check is a soft backstop, not the primary defense: the agent-native R3/R4
 * rules remain the primary defense against dropped bullets/roles. */
const OTHER_SECTION_HEADER_PHRASES = [
  "education",
  "education and training",
  "skills",
  "certifications",
  "certification",
  "licenses",
  "licensure",
  "training",
  "projects",
  "awards",
  "references",
];

/** Escape a literal phrase for use inside a RegExp alternation. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a regex that matches a line, IN FULL, against one of `phrases`
 * (case-insensitively) — optionally followed by a trailing ":" and/or a
 * trailing "(...)" parenthetical, and nothing else. */
function buildHeaderRegex(phrases) {
  const alternation = phrases.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${alternation})(?:\\s*:)?(?:\\s*\\([^()]*\\))?$`, "i");
}

const EXPERIENCE_HEADER_RE = buildHeaderRegex(EXPERIENCE_HEADER_PHRASES);
const OTHER_SECTION_HEADER_RE = buildHeaderRegex(OTHER_SECTION_HEADER_PHRASES);

/** True when `line`, trimmed and with internal whitespace collapsed, matches
 * `re` in FULL (see buildHeaderRegex) — i.e. it IS one of the allow-listed
 * header phrases (optionally with a trailing colon/parenthetical), not
 * merely a line that happens to mention one. */
function isHeaderLine(line, re) {
  const t = line.trim().replace(/\s+/g, " ");
  if (t.length === 0) return false;
  return re.test(t);
}

/** True when `line` marks the end of the CURRENT experience-scoped region:
 * a genuinely different, non-experience section (education/skills/
 * certifications/etc. — see OTHER_SECTION_HEADER_PHRASES). A SIBLING
 * experience-family header (e.g. "VOLUNTEER EXPERIENCE", "ADDITIONAL
 * EXPERIENCE") is deliberately NOT a boundary here — see the comment on
 * EXPERIENCE_HEADER_PHRASES for why: R3/R4 require all experience-type
 * roles to be counted together in one scope. */
function isOtherSectionBoundaryLine(line) {
  return isHeaderLine(line, OTHER_SECTION_HEADER_RE);
}

/**
 * Return the slice of sourceText between the experience-section header and
 * the next section boundary (or end of document), or `null` if no
 * experience-section header can be confidently located. A wrong scope is
 * worse than no check, so callers must treat `null` as "skip the check"
 * rather than falling back to the whole document.
 *
 * Scope starts at the FIRST experience-family header found. It extends
 * THROUGH any subsequent experience-family header (e.g. a "VOLUNTEER
 * EXPERIENCE" or "ADDITIONAL EXPERIENCE" section following the main "WORK
 * EXPERIENCE" one) — those header lines are simply skipped over, not
 * treated as a boundary, so every role's bullets across ALL experience-type
 * sections land in the same scoped region per R3/R4. The region ends only
 * at a genuinely different, non-experience section (education/skills/
 * certifications/etc.) or end of document.
 */
export function extractExperienceSection(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => isHeaderLine(line, EXPERIENCE_HEADER_RE));
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isOtherSectionBoundaryLine(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join("\n");
}

/**
 * Check tailored output against the source text. Returns a list of short,
 * actionable violation strings (empty when clean).
 */
export function validateTailoring(resume, sourceText) {
  const violations = [];
  const src = norm(sourceText);
  const summary = norm(resume.summary);
  const allOut = norm(outputText(resume));

  // 1. Banned summary phrases.
  for (const phrase of BANNED_SUMMARY_PHRASES) {
    if (summary.includes(phrase)) {
      violations.push(`summary contains banned phrase "${phrase}"`);
    }
  }

  // 2. Scope qualifiers not present in source.
  for (const q of SCOPE_QUALIFIERS) {
    if (allOut.includes(q) && !src.includes(q)) {
      violations.push(`output uses scope qualifier "${q}" not in the source`);
    }
  }

  // 3. Derived durations in the summary not literally present in the source.
  //    Matches "6 years", "12 months", "a decade", "over 5 years", etc.
  const durationRe =
    /\b(?:over |nearly |almost |a |[0-9]+\+? )?(?:decade|year|month)s?\b/gi;
  for (const m of resume.summary.matchAll(durationRe)) {
    const phrase = norm(m[0]);
    // "a year"/"year" alone is rarely a derived claim; only flag numeric/decade.
    if (/\d/.test(phrase) || phrase.includes("decade")) {
      if (!src.includes(phrase)) {
        violations.push(
          `summary states duration "${m[0].trim()}" not literally in the source`,
        );
      }
    }
  }

  // 4. Invented numbers in the output not traceable to the source.
  //    Tolerant: matches shorthand K/M suffixes and comma/decimal grouping.
  const seenNums = new Set();
  for (const m of allOut.matchAll(/\b\d[\d,.]*\s*[km]?\b/gi)) {
    const raw = m[0].replace(/\s+/g, "");
    const digits = raw.replace(/[,.]/g, "").replace(/[km]$/i, "");
    if (digits.length < 2) continue; // skip single digits (noisy)
    if (seenNums.has(digits)) continue;
    seenNums.add(digits);
    const srcDigits = src.replace(/[,.]/g, "");
    if (!srcDigits.includes(digits)) {
      violations.push(`number "${raw}" in output not found in the source`);
    }
  }

  // 5. Bullet accounting (R3): (experience bullets) + droppedBullets must equal
  //    the SOURCE'S EXPERIENCE SECTION bullet count — not the whole document.
  //    Real résumés commonly have bullet-marked lines outside the experience
  //    section (licenses, certifications, professional memberships, skills
  //    lists) that never belong in experience[].bullets per the schema, so
  //    counting the whole document would spuriously fire on any résumé with
  //    bulleted content elsewhere. See extractExperienceSection() for the
  //    section-boundary heuristic. If no experience-section header can be
  //    confidently located, or the scoped region has no bullet markers at all
  //    (e.g. paragraph-style prose), there's nothing reliable to compare
  //    against, so this check is skipped silently rather than firing a
  //    spurious violation or falling back to the whole document.
  const bulletMarkerRe = /^[-•*–·▪‣◦●]\s+/;
  const experienceSection = extractExperienceSection(sourceText);
  if (experienceSection !== null) {
    const sourceBulletCount = experienceSection
      .split(/\r?\n/)
      .filter((line) => bulletMarkerRe.test(line.trim())).length;
    if (sourceBulletCount > 0) {
      const outputBulletCount = resume.experience.reduce(
        (sum, e) => sum + e.bullets.length,
        0,
      );
      const droppedCount = resume.droppedBullets.length;
      if (sourceBulletCount !== outputBulletCount + droppedCount) {
        violations.push(
          `bullet accounting mismatch: source experience section has ~${sourceBulletCount} bullet-marked lines, output has ${outputBulletCount} bullets + ${droppedCount} dropped = ${outputBulletCount + droppedCount}`,
        );
      }
    }
  }

  // 6. All roles preserved (R4): every output role's company must trace back
  //    to the source text. Heuristic, since sourceText is raw freeform text
  //    with no structured source role list to diff against: check that each
  //    output role's company name appears (case-insensitively) as a substring
  //    of the source. This catches a fabricated/altered-beyond-recognition
  //    company but cannot detect a source role that was silently dropped
  //    entirely — that failure mode still relies on the agent-native R4 rule
  //    prose, same as before this fix.
  for (const e of resume.experience) {
    const company = norm(e.company);
    if (company && !src.includes(company)) {
      violations.push(
        `role company "${e.company}" not found in the source résumé text`,
      );
    }
  }

  // De-dupe and cap so a retry prompt stays short.
  const unique = [...new Set(violations)].slice(0, 12);
  return { ok: unique.length === 0, violations: unique };
}

// ---------------------------------------------------------------------------
// CLI entrypoint.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--json") flags.json = argv[++i];
    else if (a === "--resume") flags.resume = argv[++i];
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }
  if (!flags.json || !flags.resume) {
    console.error("Error: --json <path> and --resume <path-or-text> are both required.\n");
    console.error(HELP);
    process.exit(2);
  }

  const jsonPath = resolve(flags.json);
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`✖ could not read résumé JSON at ${jsonPath}: ${err.message ?? err}`);
    process.exit(1);
  }

  // Step 1: structural gate.
  const parsed = ResumeJSON.safeParse(raw);
  if (!parsed.success) {
    console.error(`✖ schema violations in ${jsonPath}:`);
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Step 2: content rules, checked against the original résumé source text.
  const resumeArg = flags.resume;
  const sourceText = existsSync(resumeArg) ? readFileSync(resumeArg, "utf8") : resumeArg;

  const cleaned = dropNoopOptimizedBullets(parsed.data);
  const result = validateTailoring(cleaned, sourceText);
  if (!result.ok) {
    console.error(`✖ content violations:`);
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log("✓ clean — no schema or content violations");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message ?? err}`);
    process.exit(1);
  });
}
