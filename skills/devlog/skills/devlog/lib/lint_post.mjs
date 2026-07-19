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

// Voice-contract bans that are safe to check deterministically (the fuller
// contract — hedge words, staccato rhythm, closers — stays with the judge,
// where context can tell a false positive from a violation). Phrases are the
// user's own explicit bans from voice-notes.md.
export const VOICE_BANNED_PHRASES = [
  /\bhonestly,/i,
  /\bI keep seeing\b/i,
  /isn't a bug, it's/i,
  /not a bug, a feature/i,
  /\bthe problem isn't\b/i,
  /here's what stuck with me/i,
];

// Sections whose text is template punctuation or verbatim quoted data, exempt
// from voice rules per SKILL.md (the `## Sources` em dash is fixed template
// punctuation; `## Changelog` quotes commit subjects as-is).
const VOICE_EXEMPT_SECTIONS = new Set(['Sources', 'Changelog']);

// Prose lines of the non-exempt sections: fenced code excluded.
function voiceCheckableLines(sections) {
  const out = [];
  for (const s of sections) {
    if (VOICE_EXEMPT_SECTIONS.has(s.heading)) continue;
    let inFence = false;
    for (const line of s.content.split('\n')) {
      if (/^```/.test(line)) { inFence = !inFence; continue; }
      if (!inFence) out.push({ heading: s.heading, line });
    }
  }
  return out;
}

// Lint a post. Returns { ok, findings: [{ rule, message }] }.
// `voice: true` adds the deterministic voice-contract rules — opt-in so the
// eval harness and non-voice callers keep their existing behavior.
export function lintPost(content, { minSources = 3, filename = null, voice = false } = {}) {
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
  if (Array.isArray(data.tags) && (data.tags.length < 5 || data.tags.length > 10)) {
    add('tags-count', `Expected 5-10 topic tags, got ${data.tags.length}.`);
  }
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (typeof t === 'string' && !TAG_PATTERN.test(t)) {
        add('tags-character-pattern', `Tag "${t}" must be lowercase alphanumeric/hyphens only (^[a-z0-9][a-z0-9-]*$).`);
      }
    }
    if (dedupeCaseInsensitive(data.tags).length !== data.tags.length) {
      add('tags-duplicate', 'Tags contain a case-insensitive duplicate.');
    }
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

  if (voice) {
    for (const { heading, line } of voiceCheckableLines(sections)) {
      if (line.includes('—')) {
        add('voice-em-dash', `Em dash in \`## ${heading}\` prose ("${line.trim().slice(0, 60)}…") — the voice contract bans them; use a comma, semicolon, or split the sentence.`);
      }
      for (const re of VOICE_BANNED_PHRASES) {
        const m = re.exec(line);
        if (m) add('voice-banned-phrase', `Banned phrase "${m[0]}" in \`## ${heading}\` — rewrite per voice-notes.md.`);
      }
    }
  }

  return { ok: findings.length === 0, findings };
}
