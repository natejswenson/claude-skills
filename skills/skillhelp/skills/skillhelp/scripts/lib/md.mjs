/**
 * File and markdown helpers, plus the secret-shaped-line refusal.
 *
 * Everything here is line-addressed on purpose: a fact this skill emits is
 * worthless without the `file:line` it came from, so the readers hand back
 * line numbers rather than blobs.
 */
import { readFileSync, existsSync } from 'node:fs';

/** Max characters of a single indexed fact. Longer lines are truncated with an
 *  ellipsis — a card is a pointer to a line, not a copy of the file. */
export const FACT_MAX = 200;

/**
 * Lines that must never reach a committed, published card.
 *
 * This repo has already shipped a redaction incident once (see CLAUDE.md's
 * gmailtriage row), and the index is committed to a public repo.
 *
 * Two defences, and it matters which does what. Markdown — SKILL.md, README,
 * CHANGELOG — is indexed VERBATIM, so a credential pasted into a doc would
 * otherwise be copied into a card; that is what this pattern list refuses.
 * Source files under `scripts/`/`bin/`/`lib/` are never indexed verbatim at
 * all: extraction lifts only identifiers from them (an env var NAME, a module
 * path), so a secret sitting in code has no path into a card by construction.
 * Refusing is cheap; unpublishing is not.
 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
];

export const looksSecret = (text) => SECRET_PATTERNS.some((re) => re.test(text));

export function readLines(abs) {
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8').split('\n').map((text, i) => ({ n: i + 1, text }));
}

export function readJson(abs) {
  if (!existsSync(abs)) return null;
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch { return null; }
}

/** Collapse a source line into one indexable sentence. Table rows, list
 *  bullets and heading markers all normalise to the same shape so a card reads
 *  as prose regardless of which file the fact was lifted out of. */
export function normalise(text) {
  let t = text.trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\|\s*/, '')
    .replace(/\s*\|\s*$/, '')
    .replace(/\s*\|\s*/g, ' — ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > FACT_MAX) t = `${t.slice(0, FACT_MAX - 1).trimEnd()}…`;
  return t;
}

/** True for lines that carry no information worth an index entry. */
export function isNoise(text) {
  const t = text.trim();
  if (t.length < 12) return true;
  if (/^[-|:\s]+$/.test(t)) return true;          // table rules
  if (/^<!--/.test(t)) return true;               // html comments, incl. press region markers
  if (/^[=─━┃╍]+$/.test(t)) return true;          // masthead rules
  return false;
}

/**
 * Group a section body into indexable BLOCKS rather than raw lines.
 *
 * Markdown prose in this repo is hard-wrapped at ~80 columns, so line-at-a-time
 * indexing produced facts like "Two things happen to mail you do not want in
 * your inbox: some of it should go in" — a sentence sawn in half, cited to a
 * line number that is technically correct and useless to read. A block is a
 * paragraph, a list item (with its continuations), or a table row, anchored at
 * the line it starts on.
 */
export function blocks(lines) {
  const out = [];
  let cur = null;
  let fence = false;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (const l of lines) {
    if (/^\s*```/.test(l.text)) { fence = !fence; flush(); continue; }
    if (fence) continue;
    const t = l.text.trim();
    if (!t || /^#{1,6}\s/.test(t)) { flush(); continue; }
    if (t.startsWith('|')) { flush(); out.push({ text: t, line: l.n }); continue; }
    if (/^([-*+]\s|\d+\.\s)/.test(t)) { flush(); cur = { text: t, line: l.n }; continue; }
    if (cur) cur.text += ` ${t}`;
    else cur = { text: t, line: l.n };
  }
  flush();
  return out;
}

/**
 * Split a markdown file into its heading sections.
 * Returns `{ level, title, line, body }` where `body` is the lines beneath the
 * heading, stopping at the next heading of the same or a higher level.
 */
export function mdSections(lines) {
  const heads = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l.text)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(l.text);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: l.n });
  }
  return heads.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j += 1) {
      if (heads[j].level <= h.level) { end = heads[j].line - 1; break; }
    }
    return { ...h, body: lines.slice(h.line, end) };
  });
}

/** The first section whose title matches, or null. */
export const findSection = (sections, re) => sections.find((s) => re.test(s.title)) ?? null;

/**
 * A heading that is a TEMPLATE placeholder, not a real section.
 *
 * devlog's SKILL.md carries the skeleton of the blog post it writes, including
 * `## <Descriptive heading: setup / prerequisites>`. That matches the Setup
 * heading rule and would fill devlog's Setup section with post-template prose —
 * a card that looks complete and answers a question about devlog with text
 * about an article devlog has not written yet.
 */
export const isPlaceholderHeading = (title) => /[<>]/.test(title) || /^(step \d+:)?\s*$/i.test(title);

/** Parse the `---` frontmatter block at the top of a SKILL.md. */
export function frontmatter(lines) {
  if (!lines || lines[0]?.text.trim() !== '---') return {};
  const out = {};
  let key = null;
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].text;
    if (t.trim() === '---') break;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(t);
    if (m) { key = m[1]; out[key] = { value: m[2].trim(), line: lines[i].n }; }
    else if (key && /^\s+\S/.test(t)) out[key].value += ` ${t.trim()}`;
  }
  for (const k of Object.keys(out)) {
    out[k].value = out[k].value.replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
