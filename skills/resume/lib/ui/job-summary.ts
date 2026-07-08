/**
 * Display-side summarizer for the confirm-job stage.
 *
 * Pure, client-safe. Takes whatever the extractor emitted + the original URL
 * and returns the three strings the confirm card renders:
 *   - role:     cleaned job title (no company/location suffix, no markdown)
 *   - company:  inferred from the ATS classifier, URL path, or hostname
 *   - location: best-effort regex sweep; undefined when nothing plausible
 *
 * The LLM continues to receive the raw `text`. This function is display only.
 */

import { classifyUrl } from "../parsing/url-classifier.ts";

export interface JobSummary {
  role: string;
  company: string;
  location?: string;
}

export function summarizeJob(input: {
  text: string;
  title?: string;
  url: string;
}): JobSummary {
  const company = inferCompany(input.url, input.title, input.text);
  const location = inferLocation(input.text, input.title);
  const role = cleanRole(input.title, input.text, company, location);
  return { role, company, location };
}

// ---------- company ----------

/**
 * Job aggregators where the hostname is NEVER the hiring company. When we hit
 * one, fall through to text-scan discovery instead of pulling the host label.
 */
const AGGREGATOR_HOSTS = new Set([
  "career.io",
  "www.career.io",
  "indeed.com",
  "www.indeed.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
  "monster.com",
  "www.monster.com",
  "simplyhired.com",
  "www.simplyhired.com",
  "dice.com",
  "www.dice.com",
]);

function inferCompany(url: string, title?: string, text?: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fallbackCompanyFromTitle(title) ?? "This company";
  }

  // 1. ATS classifier — canonical for Workday/Lever/Ashby/SmartRecruiters.
  const cls = classifyUrl(u);
  if (cls.params?.company) return smartCase(cls.params.company);

  // 2. Greenhouse (boards.greenhouse.io / job-boards.greenhouse.io / <co>.greenhouse.io).
  //    Company lives in the first path segment.
  if (/(^|\.)greenhouse\.io$/i.test(u.hostname)) {
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (seg) return smartCase(seg);
  }

  // 3. Aggregator hosts — hostname is meaningless; scan the JD text for the
  //    actual hiring company mentioned in the first few paragraphs.
  if (AGGREGATOR_HOSTS.has(u.hostname)) {
    const fromText = findCompanyInText(text ?? "");
    if (fromText) return fromText;
    // If we still can't tell, prefer the aggregator brand over "This company".
    return smartCase(u.hostname.replace(/^www\./, "").split(".")[0] || "This company");
  }

  // 4. Hostname second-level label, minus common job-subdomain prefixes.
  const host = u.hostname
    .toLowerCase()
    .replace(/^(www|jobs|careers|boards|job-boards|apply|hire|talent)\./, "");
  const label = host.split(".")[0];
  if (label && label.length >= 2) return smartCase(label);

  // 5. Last trailing segment of the title (if it looks like a proper noun).
  return fallbackCompanyFromTitle(title) ?? "This company";
}

/**
 * Scan the first ~3000 chars of JD text for "<Title-Cased Noun> is/are" — a
 * high-signal pattern aggregators can't scrub (e.g. "Border States is 100%
 * employee-owned"). Returns the matched company name or null.
 */
function findCompanyInText(text: string): string | null {
  if (!text) return null;
  const head = text.slice(0, 3000);
  // Strip markdown so "**Border States**" still matches.
  const cleaned = head.replace(/[*_]+/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // "Border States is 100%…", "Acme Inc is looking…", "Stripe is hiring…"
  const re =
    /\b([A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+){0,2})\s+(?:is|are)\s+(?:a\s|an\s|the\s|hiring|looking|seeking|100%|committed|an?\s+)/;
  const m = cleaned.match(re);
  if (!m) return null;
  const candidate = m[1].trim();
  // Filter out obvious false positives (single common words).
  const firstWord = candidate.split(/\s+/)[0];
  if (/^(This|That|We|They|It|The|Our|Your)$/i.test(firstWord)) return null;
  return candidate;
}

function fallbackCompanyFromTitle(title?: string): string | null {
  if (!title) return null;
  const parts = title.split(/\s+[-—·|]\s+/);
  const last = parts[parts.length - 1]?.trim();
  if (last && /^[A-Z][a-zA-Z]+$/.test(last)) return last;
  return null;
}

/** "nvidia" → "Nvidia"; "SAP" → "SAP"; "coinbase" → "Coinbase"; preserves explicit all-caps acronyms ≤4 chars. */
function smartCase(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

// ---------- location ----------

const COUNTRY_SHORTLIST = [
  "Singapore",
  "United States",
  "United Kingdom",
  "Canada",
  "Germany",
  "Ireland",
  "Netherlands",
  "France",
  "Spain",
  "Portugal",
  "Switzerland",
  "Australia",
  "Japan",
  "India",
  "Brazil",
  "Mexico",
  "Poland",
  "Romania",
  "Sweden",
  "Denmark",
  "Norway",
  "Finland",
  "Israel",
  "Argentina",
  "Chile",
];

function inferLocation(text: string, title?: string): string | undefined {
  // Search the title first (cheap + often dispositive), then the text head.
  const haystack = [title ?? "", text.slice(0, 2000)].join("\n");
  const cleaned = haystack
    // Drop markdown links [label](url) → label, so "Remote" inside a link still matches.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Drop markdown headings.
    .replace(/^#+\s*/gm, "");

  // "Remote - Singapore" / "Remote, US" / "Remote · EU" / "Remote — United States"
  // Cap at 2 qualifying words so we don't eat into adjacent prose like
  // "Remote - United States Product Engineering …".
  let m = cleaned.match(
    /\bRemote\s*[-—·,]\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/,
  );
  if (m) return `Remote — ${m[1].trim()}`;
  if (/\bRemote\b(?!\s*(?:work|first|ly))/i.test(cleaned)) {
    return "Remote";
  }

  // "... in Fargo, ND" / "located in: Fargo, ND" — explicit location markers
  // we can trust mid-prose. Tighter than free city-STATE scans.
  m = cleaned.match(
    /\b(?:located\s+in|position\s+(?:will\s+be\s+)?(?:located\s+)?in|based\s+in|in)\s*:?\s*([A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+){0,2}),\s*([A-Z]{2})\b/,
  );
  if (m) return `${m[1]}, ${m[2]}`;

  // "San Francisco, CA" / "New York, NY" — anchor to a boundary that looks like
  // the start of a location line, not a lowercase word boundary mid-prose.
  m = cleaned.match(
    /(?:^|[\n|·•])\s*([A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+){0,2}),\s*([A-Z]{2})\b/m,
  );
  if (m) return `${m[1]}, ${m[2]}`;

  // "Stuttgart" / "London" / country shortlist — boundary-anchored.
  const countryRe = new RegExp(
    `(?:^|[\\n|·•])\\s*(${COUNTRY_SHORTLIST.map(escapeRegex).join("|")})\\b`,
    "m",
  );
  m = cleaned.match(countryRe);
  if (m) return m[1];

  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- role ----------

function cleanRole(
  rawTitle: string | undefined,
  text: string,
  company: string,
  location: string | undefined,
): string {
  let base = (rawTitle ?? "").trim();

  // Fallback: first `# <heading>` line in the text.
  if (!base) {
    const headingMatch = text.match(/^#{1,3}\s+([^\n]{3,120})/m);
    if (headingMatch) base = headingMatch[1].trim();
  }

  // Strip private-use unicode glyphs (icon-font leakage).
  base = base.replace(/[\u{E000}-\u{F8FF}]/gu, "");
  // Strip markdown heading markers and link syntax.
  base = base.replace(/^#+\s*/g, "");
  base = base.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip aggregator-style " in <City>, <ST>(, <Country>)?(- <anything>)?" tail.
  // Catches titles like "Sr DevOps Engineer in Fargo, ND, US - Career.io".
  base = base.replace(
    /\s+in\s+[A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+){0,2},\s*[A-Z]{2,3}(?:,\s*[A-Z]{2,3})?(?:\s*[-—·|]\s*[\w.]+)?\s*$/,
    "",
  );

  // Iteratively strip trailing company/location/location-part suffixes.
  const targets = new Set<string>();
  if (company && company !== "This company") targets.add(company);
  if (location) {
    targets.add(location);
    // Also strip "Remote", "Singapore" etc. individually so we handle titles
    // like "Engineer - Remote - Singapore - Coinbase" where components appear
    // as separate ` - ` segments.
    for (const part of location.split(/\s*[—\-·,]\s*/)) {
      const p = part.trim();
      if (p.length >= 2) targets.add(p);
    }
  }

  const sepTail = String.raw`\s*[,|·\-—]\s*`;
  const corpSuffix = String.raw`(?:\s+(?:Corp(?:oration)?|Inc\.?|Ltd\.?|LLC|GmbH|AG|Co\.?|Company|Careers))?`;
  let changed = true;
  let safety = 10;
  while (changed && safety-- > 0) {
    changed = false;
    for (const t of targets) {
      const re = new RegExp(
        `${sepTail}${escapeRegex(t)}${corpSuffix}\\s*$`,
        "i",
      );
      if (re.test(base)) {
        base = base.replace(re, "");
        changed = true;
      }
    }
  }

  // Trim lingering separators / punctuation.
  base = base.replace(/[\s,|·\-—]+$/g, "").trim();
  base = base.replace(/\s+/g, " ");

  if (!base) return rawTitle?.trim() || "Role";
  return base;
}
