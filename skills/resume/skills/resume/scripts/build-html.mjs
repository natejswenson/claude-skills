#!/usr/bin/env node
/**
 * build-html.mjs — turn a validated ResumeJSON into the skill's ONE semantic
 * HTML document.
 *
 * This module is the structural half of the template; a theme stylesheet
 * (assets/themes/*.css) is the visual half. The markup here is deliberately
 * FIXED — themes restyle it, they never fork it. That contract is what lets
 * `press` and `ats-plain` be the same résumé rendered two ways, and it is
 * documented for theme authors in references/theme-contract.md.
 *
 * Three rules govern the markup, each learned from a measured ATS failure
 * (see the render baseline in scripts/baseline-render.test.mjs):
 *
 *   1. Section headings are real <h2> elements in document order. A theme may
 *      move one into a left gutter visually, but it is never removed from the
 *      flow and never replaced by a styled <div> — parsers key on it.
 *   2. Every contact line is ONE unbroken text node. Splitting a right-aligned
 *      line with inline <span> separators reorders the runs in the PDF content
 *      stream; that shipped once and pushed the email address to line six.
 *   3. Nothing that carries meaning lives in CSS ::before/::after content.
 *      Generated content does not reliably survive text extraction.
 */

/** Escape a value for interpolation into HTML text or an attribute. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Monogram for the masthead stamp: first letter of the first and last word of
 * the name. Themes that don't want a stamp hide `.stamp`; it stays in the DOM
 * either way so the choice is purely visual.
 */
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Strip the scheme (and any trailing slash) from a URL for display. The href
 * keeps the full URL; only the visible text is shortened, and it stays a
 * single text node.
 */
export function displayLink(url) {
  return String(url ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** A role is "current" when its end date reads as ongoing. */
export function isCurrent(endDate) {
  return /\b(present|current|now|ongoing)\b/i.test(String(endDate ?? ""));
}

/**
 * Split a skill entry on a leading "Label: value" prefix so grouped skills
 * ("CI/CD: GitHub Actions, Jenkins") get structure without a schema change.
 * An entry with no colon is returned as a value-only chip.
 *
 * Only the FIRST colon splits, and only when the label is short and colon-free
 * — otherwise a sentence-shaped skill containing a colon would be mangled into
 * a nonsense label.
 */
export function splitSkill(entry) {
  const text = String(entry ?? "").trim();
  const idx = text.indexOf(":");
  if (idx > 0 && idx <= 40) {
    const label = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    if (label && value) return { label, value };
  }
  return { label: null, value: text };
}

function section(id, heading, inner) {
  if (!inner) return "";
  return `    <section class="sec sec-${id}">
      <h2>${esc(heading)}</h2>
      <div class="sbody">
${inner}
      </div>
    </section>`;
}

function mastheadHtml(resume) {
  const { contact = {} } = resume;
  // The role line is the current (first-listed) job title, not a new field —
  // deriving it keeps ResumeJSON the single source of truth.
  const role = resume.experience?.[0]?.title;

  const lines = [];
  if (contact.email) lines.push({ cls: "c-email", text: contact.email });
  if (contact.phone) lines.push({ cls: "c-phone", text: contact.phone });
  if (contact.location) lines.push({ cls: "c-location", text: contact.location });
  for (const link of contact.links ?? []) {
    lines.push({ cls: "c-link", text: displayLink(link), href: link });
  }

  const contactHtml = lines
    .map(({ cls, text, href }) => {
      // One unbroken text node per line — see rule 2 in the file header.
      const body = href
        ? `<a href="${esc(href)}">${esc(text)}</a>`
        : esc(text);
      return `          <li class="${cls}">${body}</li>`;
    })
    .join("\n");

  return `    <header class="mast">
      <div class="stamp" aria-hidden="true">${esc(initials(resume.name))}</div>
      <div class="identity">
        <h1 class="name">${esc(resume.name)}</h1>
${role ? `        <p class="role">${esc(role)}</p>\n` : ""}      </div>
      <ul class="contact">
${contactHtml}
      </ul>
    </header>`;
}

function highlightsHtml(resume) {
  const items = resume.highlights ?? [];
  if (items.length === 0) return "";
  const rows = items
    .map(
      (h) => `          <li class="fact">
            <span class="flabel">${esc(h.label)}</span>
            <span class="fval">${esc(h.value)}</span>
${h.caption ? `            <span class="fcap">${esc(h.caption)}</span>\n` : ""}          </li>`
    )
    .join("\n");
  return `        <ul class="facts">
${rows}
        </ul>`;
}

function skillsHtml(resume) {
  const items = resume.skills ?? [];
  if (items.length === 0) return "";

  const parsed = items.map(splitSkill);
  // Two genuinely different shapes need two different layouts: grouped skills
  // ("CI/CD: Jenkins, GitHub Actions") want a labelled block each, while bare
  // keywords ("AWS", "Terraform") want to flow inline — one bare keyword per
  // line wastes half a page. The structure stays fixed; this class is the
  // signal a theme keys off, so both cases are styleable.
  const grouped = parsed.some((s) => s.label);

  const rows = parsed
    .map(({ label, value }) => {
      const labelHtml = label ? `<span class="k">${esc(label)}</span>` : "";
      return `          <li class="skill">${labelHtml}<span class="v">${esc(value)}</span></li>`;
    })
    .join("\n");

  return `        <ul class="skills ${grouped ? "grouped" : "flat"}">
${rows}
        </ul>`;
}

function experienceHtml(resume) {
  const jobs = resume.experience ?? [];
  if (jobs.length === 0) return "";
  return jobs
    .map((job) => {
      const bullets = (job.bullets ?? [])
        .map((b) => `            <li>${esc(b)}</li>`)
        .join("\n");
      const dateCls = isCurrent(job.endDate) ? "jdate now" : "jdate";
      // Company and location are separate elements but each is its own text
      // node; the separator is a theme concern, not a content one.
      const where = job.location
        ? `<span class="where">${esc(job.location)}</span>`
        : "";
      return `        <div class="job">
          <div class="jhead">
            <h3 class="jtitle">${esc(job.title)}</h3>
            <p class="${dateCls}">${esc(job.startDate)} &ndash; ${esc(job.endDate)}</p>
          </div>
          <p class="jorg"><span class="company">${esc(job.company)}</span>${where}</p>
${bullets ? `          <ul class="bullets">\n${bullets}\n          </ul>\n` : ""}        </div>`;
    })
    .join("\n");
}

function projectsHtml(resume) {
  const items = resume.projects ?? [];
  if (items.length === 0) return "";
  return items
    .map(
      (p) => `        <div class="project">
          <div class="phead">
            <h3 class="pname">${esc(p.name)}</h3>
${p.meta ? `            <p class="pmeta">${esc(p.meta)}</p>\n` : ""}          </div>
          <p class="pdesc">${esc(p.description)}</p>
        </div>`
    )
    .join("\n");
}

function educationHtml(resume) {
  const items = resume.education ?? [];
  if (items.length === 0) return "";
  return items
    .map((e) => {
      // School and year read as one line but are separate nodes so a theme can
      // split them; the year is appended to the school text, never generated.
      const meta = [e.school, e.year].filter(Boolean).join(" · ");
      return `        <div class="edu">
          <p class="degree">${esc(e.degree)}</p>
          <p class="school">${esc(meta)}</p>
${e.details ? `          <p class="edetails">${esc(e.details)}</p>\n` : ""}        </div>`;
    })
    .join("\n");
}

function colophonHtml(resume) {
  const { contact = {} } = resume;
  const meta = [contact.email, contact.phone].filter(Boolean).join(" · ");
  return `    <footer class="colophon">
      <span class="cname">${esc(resume.name)}</span>
${meta ? `      <span class="cmeta">${esc(meta)}</span>\n` : ""}    </footer>`;
}

/**
 * Build the full standalone HTML document for a résumé.
 *
 * @param resume  a ResumeJSON object (parse it with validate.mjs's schema first)
 * @param css     theme stylesheet source, inlined into a <style> block
 */
export function buildResumeHtml(resume, css = "") {
  const body = [
    mastheadHtml(resume),
    section("summary", "Summary", resume.summary ? `        <p class="stand">${esc(resume.summary)}</p>` : ""),
    section("highlights", "At a Glance", highlightsHtml(resume)),
    section("skills", "Skills", skillsHtml(resume)),
    section("experience", "Experience", experienceHtml(resume)),
    section("projects", "Open Source", projectsHtml(resume)),
    section("education", "Education", educationHtml(resume)),
    colophonHtml(resume),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(resume.name)} — Résumé</title>
<style>
${css}
</style>
</head>
<body>
  <article class="resume">
${body}
  </article>
</body>
</html>
`;
}

export default buildResumeHtml;
