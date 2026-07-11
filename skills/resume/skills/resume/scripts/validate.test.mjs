#!/usr/bin/env node
/**
 * Unit tests for the deterministic tailoring validator (scripts/validate.mjs).
 *
 * Run: node scripts/validate.test.mjs
 */
import assert from "node:assert/strict";
const { validateTailoring, dropNoopOptimizedBullets, extractExperienceSection } =
  await import("./validate.mjs");

let pass = 0,
  fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
    fail++;
  }
}

const base = {
  name: "Test",
  contact: { links: [] },
  summary: "Backend engineer building Python services with Django.",
  experience: [
    { title: "Engineer", company: "Acme", startDate: "2020", endDate: "Present", bullets: ["Built Python services"] },
  ],
  skills: ["Python", "Django"],
  education: [],
  droppedBullets: [],
  optimizedBullets: [],
};
const SOURCE = "Engineer at Acme. Built Python services. Skills: Python, Django.";

const has = (res, frag) => res.violations.some((v) => v.includes(frag));

test("clean output passes", () => {
  const r = validateTailoring(base, SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

test("banned summary phrase is flagged", () => {
  const r = validateTailoring(
    { ...base, summary: "Seasoned engineer with deep expertise in Python." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "deep expertise") || has(r, "seasoned"), r.violations.join(" | "));
});

test("scope qualifier not in source is flagged", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Built Python services at scale"] }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "at scale"), r.violations.join(" | "));
});

test("scope qualifier present in source is allowed", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Built Python services at scale"] }] },
    SOURCE + " operating at scale.",
  );
  assert(!has(r, "at scale"), r.violations.join(" | "));
});

test("derived years not in source is flagged", () => {
  const r = validateTailoring(
    { ...base, summary: "Engineer with 12 years building Python services." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "12 years") || has(r, "duration"), r.violations.join(" | "));
});

test("invented number is flagged", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Improved performance by 47% across 19 teams"] }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "47") || has(r, "19"), r.violations.join(" | "));
});

test("number present in source is allowed", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Led 15 services"] }] },
    SOURCE + " across 15 services.",
  );
  assert(!has(r, '"15"'), r.violations.join(" | "));
});

test("dropNoopOptimizedBullets removes unchanged entries, keeps real ones", () => {
  const resume = {
    ...base,
    optimizedBullets: [
      { original: "Built Python services", rewritten: "Built Python services", role: "Acme" }, // noop
      { original: "  Led work  ", rewritten: "Led work", role: "Acme" }, // noop after trim
      { original: "Wrote docs", rewritten: "Authored on-call runbook", role: "Acme" }, // real
    ],
  };
  const out = dropNoopOptimizedBullets(resume);
  assert.equal(out.optimizedBullets.length, 1, "expected only the real change to survive");
  assert.equal(out.optimizedBullets[0].rewritten, "Authored on-call runbook");
});

test("dropNoopOptimizedBullets returns same object when nothing is a noop", () => {
  const resume = { ...base, optimizedBullets: [{ original: "a", rewritten: "b", role: "Acme" }] };
  assert.equal(dropNoopOptimizedBullets(resume), resume, "should be referentially identical");
});

// --- R3: bullet accounting (experience-section-scoped) ----------------------

// Modeled on the rn-clinical fixture's actual structure (see
// fixtures/perf/resumes/03-rn-clinical.txt): bulleted content OUTSIDE the
// experience section (licenses, professional memberships) PLUS bullets
// inside it. This is the exact shape that exposed the old whole-document bug
// — counting all 7 bullet-marked lines in the doc against 3 real experience
// bullets would have spuriously failed.
const MULTI_SECTION_SOURCE = `Jordan Doe
Engineer

LICENSES & CERTIFICATIONS
- AWS Certified Solutions Architect
- Scrum Master Certification

EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks
- Mentored two junior engineers

EDUCATION
B.S. Computer Science

PROFESSIONAL MEMBERSHIPS
- ACM Member
- IEEE Member
`;

test("bullet accounting: experience-section-scoped count passes (whole-doc bug does not resurface)", () => {
  const resume = {
    ...base,
    experience: [
      {
        ...base.experience[0],
        bullets: ["Built Python services", "Wrote on-call runbooks"],
      },
    ],
    droppedBullets: ["Mentored two junior engineers"],
  };
  const r = validateTailoring(resume, MULTI_SECTION_SOURCE);
  // Scoped count is 3 (2 output + 1 dropped) against 3 real experience
  // bullets. The whole document has 7 bullet-marked lines (3 experience + 2
  // license + 2 membership), which would have spuriously failed under the
  // old unscoped heuristic.
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

test("bullet accounting: silently dropped real experience bullet (not recorded) is flagged", () => {
  const resume = {
    ...base,
    experience: [
      {
        ...base.experience[0],
        bullets: ["Built Python services", "Wrote on-call runbooks"],
      },
    ],
    droppedBullets: [], // "Mentored two junior engineers" vanished untracked
  };
  const r = validateTailoring(resume, MULTI_SECTION_SOURCE);
  assert.equal(r.ok, false);
  assert(has(r, "bullet accounting mismatch"), r.violations.join(" | "));
});

test("bullet accounting: no experience-section header found skips the check (no spurious violation)", () => {
  // No "experience"/"work history"/"employment history" header anywhere —
  // the heuristic can't confidently locate a scope, so per the "wrong scope
  // is worse than no check" rule this must skip rather than fall back to
  // counting the whole document.
  const NO_HEADER_SOURCE = `Jordan Doe
Freelance Consultant

SKILLS
- Python
- Django
- AWS

CERTIFICATIONS
- PMP
`;
  const resume = {
    ...base,
    experience: [{ ...base.experience[0], bullets: [] }],
    droppedBullets: [],
  };
  assert.equal(extractExperienceSection(NO_HEADER_SOURCE), null);
  const r = validateTailoring(resume, NO_HEADER_SOURCE);
  assert(!has(r, "bullet accounting"), r.violations.join(" | "));
});

test("bullet accounting: no bullet markers in source skips the check", () => {
  // SOURCE (module-level fixture) is plain prose with no bullet markers at
  // all, so the heuristic has nothing reliable to compare against.
  const resume = {
    ...base,
    experience: [{ ...base.experience[0], bullets: [] }],
    droppedBullets: [],
  };
  const r = validateTailoring(resume, SOURCE);
  assert(!has(r, "bullet accounting"), r.violations.join(" | "));
});

test("extractExperienceSection: isolates only the experience section from a multi-section résumé", () => {
  const section = extractExperienceSection(MULTI_SECTION_SOURCE);
  assert(section !== null);
  assert(!section.includes("AWS Certified"), "should not include content before the header");
  assert(!section.includes("ACM Member"), "should not include content after the section ends");
  assert(section.includes("Built Python services"));
});

// --- R3 hardening: sibling experience-family sections & header false-positives ---

// Finding (round 6): a sibling "*EXPERIENCE" section (volunteer/additional/
// leadership) immediately following the main experience section must NOT be
// treated as a scope boundary. R3 says "count the source bullets across all
// roles" and R4 says "preserve all roles" — there is no separate output array
// for volunteer/additional/leadership roles, they all fold into the SAME
// experience[] array, so the source-side scope must extend through sibling
// experience-family headers (skipping the header line itself) rather than
// stopping at the first one. A prior round had this backwards; that was the
// bug, not the fix.
const SIBLING_EXPERIENCE_SOURCE = `Jordan Doe

WORK EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks

VOLUNTEER EXPERIENCE

Habitat for Humanity
- Organized weekend builds
- Led fundraising drive
`;

test("extractExperienceSection: a sibling VOLUNTEER EXPERIENCE header does NOT end the scope — bullets on both sides are swept into one region (R3/R4)", () => {
  const section = extractExperienceSection(SIBLING_EXPERIENCE_SOURCE);
  assert(section !== null);
  assert(section.includes("Built Python services"));
  assert(section.includes("Wrote on-call runbooks"));
  assert(section.includes("Organized weekend builds"), "volunteer bullets must be swept into the same scoped region per R3/R4 (all roles fold into one experience[] array)");
  assert(section.includes("Led fundraising drive"), "volunteer bullets must be swept into the same scoped region per R3/R4");
});

test("bullet accounting: a fully-preserved sibling VOLUNTEER EXPERIENCE role's bullets are counted TOGETHER with the main role's bullets", () => {
  const resume = {
    ...base,
    experience: [
      { ...base.experience[0], bullets: ["Built Python services", "Wrote on-call runbooks"] },
      { title: "Volunteer", company: "Habitat for Humanity", startDate: "", endDate: "", bullets: ["Organized weekend builds", "Led fundraising drive"] },
    ],
    droppedBullets: [],
  };
  // R3/R4: all 4 source bullets (2 work + 2 volunteer) across BOTH roles in
  // experience[] must be counted together as 4, not just the first role's 2.
  const r = validateTailoring(resume, SIBLING_EXPERIENCE_SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

test("bullet accounting: silently dropping the sibling VOLUNTEER role's bullets (without recording them) is still flagged", () => {
  const resume = {
    ...base,
    experience: [
      { ...base.experience[0], bullets: ["Built Python services", "Wrote on-call runbooks"] },
    ],
    droppedBullets: [], // the 2 volunteer bullets vanished untracked
  };
  const r = validateTailoring(resume, SIBLING_EXPERIENCE_SOURCE);
  assert.equal(r.ok, false, "source now scopes to 4 bullets (2 work + 2 volunteer); output+dropped only accounts for 2");
  assert(has(r, "bullet accounting mismatch"), r.violations.join(" | "));
});

// Finding 2: a short PROFILE/summary line that merely mentions "experience"
// inside a grammatical sentence (verb/object structure, sentence-final
// period) must not be mistaken for the start of the experience section.
const FALSE_POSITIVE_PROSE_SOURCE = `Jordan Doe

PROFILE
Strong experience shipping products.
- Note about profile (not a real experience bullet)

EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks
`;

test("extractExperienceSection: a prose line merely mentioning 'experience' is not treated as the section start", () => {
  const section = extractExperienceSection(FALSE_POSITIVE_PROSE_SOURCE);
  assert(section !== null);
  assert(!section.includes("Note about profile"), "should not start scope at the false-positive prose line");
  assert(section.includes("Built Python services"));
  assert(section.includes("Wrote on-call runbooks"));
});

test("bullet accounting: false-positive prose line does not corrupt the real experience-section count", () => {
  const resume = {
    ...base,
    experience: [
      { ...base.experience[0], bullets: ["Built Python services", "Wrote on-call runbooks"] },
    ],
    droppedBullets: [],
  };
  const r = validateTailoring(resume, FALSE_POSITIVE_PROSE_SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

// Finding 2(b): when a bulleted SKILLS section sits between the false-positive
// prose line and the REAL experience header, the old bug would terminate the
// scoped region at SKILLS before ever reaching EXPERIENCE — silently
// disabling the check. The fix must still reach the real section.
const FALSE_POSITIVE_THEN_SKILLS_SOURCE = `Jordan Doe

PROFILE
Strong experience shipping products.

SKILLS
- Python
- Django

EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks
`;

test("extractExperienceSection: false-positive prose followed by a bulleted SKILLS section still reaches the real EXPERIENCE header", () => {
  const section = extractExperienceSection(FALSE_POSITIVE_THEN_SKILLS_SOURCE);
  assert(section !== null, "must not silently disable the check by scoping to before SKILLS");
  assert(!section.includes("Django"), "should not have scoped to the SKILLS section");
  assert(section.includes("Built Python services"));
  assert(section.includes("Wrote on-call runbooks"));
});

test("bullet accounting: false-positive prose + intervening SKILLS section does not disable the check", () => {
  const resume = {
    ...base,
    experience: [
      { ...base.experience[0], bullets: ["Built Python services"] }, // dropped one on purpose
    ],
    droppedBullets: [],
  };
  const r = validateTailoring(resume, FALSE_POSITIVE_THEN_SKILLS_SOURCE);
  // Real section has 2 bullets; output accounts for only 1 with nothing
  // dropped — this MUST be flagged. If the check were silently disabled
  // (the pre-fix bug), this mismatch would slip through as "ok".
  assert.equal(r.ok, false, "check must not be silently disabled");
  assert(has(r, "bullet accounting mismatch"), r.violations.join(" | "));
});

// Regression guard: EDUCATION (a genuinely non-experience section, even with
// its own bulleted details) must still terminate the scope as before — the
// round-6 fix only changed how SIBLING EXPERIENCE-family headers are
// handled, not OTHER_SECTION_HEADER_PHRASES boundaries.
const WORK_THEN_EDUCATION_WITH_BULLETS_SOURCE = `Jordan Doe

WORK EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks

EDUCATION
B.S. Computer Science
- Dean's List all semesters
- Relevant coursework: Algorithms, Databases
`;

test("extractExperienceSection: EDUCATION with its own bulleted details still ends the scope (no regression)", () => {
  const section = extractExperienceSection(WORK_THEN_EDUCATION_WITH_BULLETS_SOURCE);
  assert(section !== null);
  assert(section.includes("Built Python services"));
  assert(section.includes("Wrote on-call runbooks"));
  assert(!section.includes("Dean's List"), "education bullets must not be swept into the experience scope");
  assert(!section.includes("Relevant coursework"), "education bullets must not be swept into the experience scope");
});

test("bullet accounting: EDUCATION's bulleted details do not inflate the source count (no regression)", () => {
  const resume = {
    ...base,
    experience: [
      { ...base.experience[0], bullets: ["Built Python services", "Wrote on-call runbooks"] },
    ],
    droppedBullets: [],
  };
  const r = validateTailoring(resume, WORK_THEN_EDUCATION_WITH_BULLETS_SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

// --- R3 hardening round 4: allow-list redesign of header detection ---------

// Finding: a short, unpunctuated bullet that merely mentions "experience"
// (or a section-name word) satisfies every exclusion-based gate the old
// heuristic used (short line, no trailing punctuation, ≤5 words) while still
// not being an actual section header. The allow-list redesign rejects this
// structurally: the line isn't EQUAL to any allow-listed header phrase.
const SHORT_BULLET_PREHEADER_SOURCE = `Jordan Doe

SUMMARY
- Led 5 years experience

EXPERIENCE

Acme Inc
Engineer | 2020 - Present
- Built Python services
- Wrote on-call runbooks
`;

test("extractExperienceSection: a short bullet mentioning 'experience' before the real header is not mistaken for the section start", () => {
  const section = extractExperienceSection(SHORT_BULLET_PREHEADER_SOURCE);
  assert(section !== null);
  assert(!section.includes("Led 5 years experience"), "should not start scope at the false-positive bullet");
  assert(section.includes("Built Python services"));
  assert(section.includes("Wrote on-call runbooks"));
});

const ALL_CAPS_MIDSECTION_SOURCE = `JORDAN DOE

WORK EXPERIENCE

ACME INC
ENGINEER | 2020 - PRESENT
- BUILT PYTHON SERVICES
- LED 5 YEARS EXPERIENCE
- WROTE ON-CALL RUNBOOKS

EDUCATION
B.S. COMPUTER SCIENCE
`;

test("extractExperienceSection: an ALL-CAPS short bullet mentioning EXPERIENCE mid-section is not mistaken for a boundary", () => {
  const section = extractExperienceSection(ALL_CAPS_MIDSECTION_SOURCE);
  assert(section !== null);
  assert(section.includes("BUILT PYTHON SERVICES"));
  assert(
    section.includes("LED 5 YEARS EXPERIENCE"),
    "the bullet itself must remain inside the scoped region, not truncate it",
  );
  assert(section.includes("WROTE ON-CALL RUNBOOKS"));
  assert(!section.includes("B.S. COMPUTER SCIENCE"), "should still stop at the real EDUCATION boundary");
});

test("bullet accounting: an ALL-CAPS short bullet mentioning EXPERIENCE mid-section counts as a normal bullet, not a boundary", () => {
  const resume = {
    ...base,
    experience: [
      {
        ...base.experience[0],
        bullets: ["BUILT PYTHON SERVICES", "LED 5 YEARS EXPERIENCE", "WROTE ON-CALL RUNBOOKS"],
      },
    ],
    droppedBullets: [],
  };
  const r = validateTailoring(resume, ALL_CAPS_MIDSECTION_SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

// Sanity: real header phrases still match with trailing colon/parenthetical.
test("isHeaderLine allow-list: header phrases still match with trailing colon or parenthetical", () => {
  const section1 = extractExperienceSection(`Jordan Doe

Experience:

Acme Inc
- Built Python services
`);
  assert(section1 !== null && section1.includes("Built Python services"));

  const section2 = extractExperienceSection(`Jordan Doe

EXPERIENCE (2015-Present)

Acme Inc
- Built Python services
`);
  assert(section2 !== null && section2.includes("Built Python services"));
});

// --- R4: all roles preserved ------------------------------------------------

test("role preservation: output role's company found in source passes", () => {
  const r = validateTailoring(base, SOURCE);
  assert(!r.violations.some((v) => v.includes("not found in the source")), r.violations.join(" | "));
});

test("role preservation: output role's company missing from source is flagged", () => {
  const resume = {
    ...base,
    experience: [{ ...base.experience[0], company: "Globex Corp" }],
  };
  const r = validateTailoring(resume, SOURCE);
  assert.equal(r.ok, false);
  assert(has(r, "Globex Corp"), r.violations.join(" | "));
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
