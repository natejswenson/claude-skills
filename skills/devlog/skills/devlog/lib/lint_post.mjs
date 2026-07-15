// Deterministic post-contract lint. This is the mechanically-checkable subset
// of the how-to quality contract in SKILL.md Step 6; the judgment calls
// (reproducibility, gotcha quality, voice) belong to the self-review rubric
// and the eval judge, not here.
import { basename } from 'node:path';
import { RE_FINAL_RELEASE } from './core.mjs';

export const FRONTMATTER_KEYS = ['title', 'date', 'project', 'version', 'tags', 'summary'];
export const REQUIRED_SECTIONS = ['Shipped', 'Gotchas', 'Sources'];

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// First-occurrence wins: keeps the first casing seen, drops later
// case-insensitive duplicates. A same-case repeat is the reachable case in
// practice — TAG_PATTERN already forbids the case-differing variant outright.
export function dedupeCaseInsensitive(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Minimal frontmatter parser: `--- ... ---` fence, `key: value` lines, flow
// arrays for tags. Prototype-free target object; unknown keys are kept (the
// contract does not forbid extras) but only allowlisted keys are checked.
export function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { data: null, body: content };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { data: null, body: content };

  const data = Object.create(null);
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    data[m[1]] = parseScalar(m[2]);
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

function parseScalar(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2)
    || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((t) => parseScalar(t));
  }
  return v;
}

// Split the body into sections keyed by `## ` heading, ignoring headings
// inside fenced code blocks. Returns [{ heading, content }].
export function splitSections(body) {
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (h && !line.startsWith('###')) {
      current = { heading: h[1], content: [] };
      sections.push(current);
    } else if (current) {
      current.content.push(line);
    }
  }
  return sections.map((s) => ({ heading: s.heading, content: s.content.join('\n') }));
}

// Every opening code fence must carry a language tag. Returns 1-based line
// numbers of untagged openers.
export function findUntaggedFences(body) {
  const untagged = [];
  let inFence = false;
  body.split('\n').forEach((line, i) => {
    const m = /^```(.*)$/.exec(line);
    if (!m) return;
    if (!inFence) {
      if (m[1].trim() === '') untagged.push(i + 1);
      inFence = true;
    } else {
      inFence = false;
    }
  });
  return untagged;
}

// Ignore differences that don't change the destination: trailing slash and
// URL fragment.
export function normalizeUrl(url) {
  return url.replace(/#.*$/, '').replace(/\/+$/, '');
}

export function extractSourceUrls(sectionContent) {
  const urls = new Set();
  for (const m of sectionContent.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    urls.add(m[1]);
  }
  return urls;
}

// Lint a post. Returns { ok, findings: [{ rule, message }] }.
export function lintPost(content, { minSources = 3, filename = null } = {}) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });

  const { data, body } = parseFrontmatter(content);
  if (!data) {
    add('frontmatter-missing', 'Post must start with a `---` frontmatter block.');
    return { ok: false, findings };
  }

  for (const key of FRONTMATTER_KEYS) {
    const v = data[key];
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) add(`frontmatter-${key}`, `Frontmatter field \`${key}\` is missing or empty.`);
  }

  if (typeof data.date === 'string' && data.date && !RE_DATE.test(data.date)) {
    add('date-format', `\`date\` must be YYYY-MM-DD: got ${JSON.stringify(data.date)}.`);
  }
  if (typeof data.version === 'string' && data.version && !RE_FINAL_RELEASE.test(data.version)) {
    add('version-format', `\`version\` must match v<digits.digits...>: got ${JSON.stringify(data.version)}.`);
  }
  if (typeof data.title === 'string' && data.title) {
    if (/^release\s+v/i.test(data.title) || data.title.trim() === data.version) {
      add('title-style', 'Title must be essay-style, not a "release vX.Y.Z" label.');
    }
  }
  if (Array.isArray(data.tags) && (data.tags.length < 2 || data.tags.length > 5)) {
    add('tags-count', `Expected 2-5 topic tags, got ${data.tags.length}.`);
  }
  if (filename && typeof data.version === 'string' && data.version) {
    const expected = `${data.version}.md`;
    if (basename(filename) !== expected) {
      add('filename-version', `Filename must be \`${expected}\` (got \`${basename(filename)}\`).`);
    }
  }

  const sections = splitSections(body);
  const byHeading = new Map(sections.map((s) => [s.heading, s]));
  for (const name of REQUIRED_SECTIONS) {
    if (!byHeading.has(name)) add(`section-${name.toLowerCase()}`, `Missing required \`## ${name}\` section.`);
  }

  const gotchas = byHeading.get('Gotchas');
  if (gotchas && gotchas.content.replace(/\s/g, '').length < 40) {
    add('gotchas-empty', 'The `## Gotchas` section is present but effectively empty.');
  }

  const sources = byHeading.get('Sources');
  if (sources) {
    const urls = extractSourceUrls(sources.content);
    if (urls.size < minSources) {
      add('sources-count', `Need at least ${minSources} distinct source URLs; found ${urls.size}.`);
    }
    // The contract requires claims to carry their citation where they're made,
    // not only in the bibliography: every Sources URL must also be cited
    // inline somewhere else in the body.
    const inline = new Set();
    for (const s of sections) {
      if (s.heading === 'Sources') continue;
      for (const u of extractSourceUrls(s.content)) inline.add(normalizeUrl(u));
    }
    for (const u of urls) {
      if (!inline.has(normalizeUrl(u))) {
        add('sources-inline', `Source ${u} is listed in \`## Sources\` but never cited inline in the body — cite it where its claim is made, or drop it from Sources.`);
      }
    }
  }

  for (const line of findUntaggedFences(body)) {
    add('fence-untagged', `Code fence at body line ${line} has no language tag.`);
  }

  return { ok: findings.length === 0, findings };
}
