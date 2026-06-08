/**
 * HTML → text parsers used by tier 3.
 *
 * Chain tried in order (stop at first result ≥ MIN_CHARS):
 *   1. JSON-LD schema.org JobPosting
 *   2. OpenGraph og:description (best for short-description fallback)
 *   3. Mozilla Readability
 *   4. RSC / Next.js __next_f streaming payload
 *   5. Body text (last resort)
 */

// jsdom and @mozilla/readability are ESM-only packages. Turbopack's
// serverExternalPackages path in Next 16 emits a CJS require() for them,
// which throws ERR_REQUIRE_ESM at lambda load and causes /api/extract-job
// to serve the static /500 page (issue #18). Importing them dynamically
// inside the helpers produces a real import() in the bundle instead,
// which Node handles correctly for ESM modules. ESM cache dedupes the
// cost to the first cold-start call per instance.
type JsdomModule = typeof import("jsdom");
type ReadabilityModule = typeof import("@mozilla/readability");

export const MIN_CHARS = 200;

// ---------- helpers ----------

/** Decode common HTML entities and strip tags. Cheap; not a full parser. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- 1. JSON-LD JobPosting ----------

export interface JobLdResult {
  text: string;
  title?: string;
}

/**
 * Parse all `<script type="application/ld+json">` blocks in the HTML.
 * If any contains a JobPosting-typed object (directly or nested in @graph),
 * return its description (+ title if present).
 */
export function extractJsonLd(html: string): JobLdResult | null {
  const scriptRe =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed block — skip
    }
    const candidates = flattenLd(parsed);
    for (const obj of candidates) {
      if (isJobPosting(obj)) {
        const descHtml =
          typeof obj.description === "string" ? obj.description : "";
        if (!descHtml) continue;
        const text = htmlToPlainText(descHtml);
        if (text.length >= MIN_CHARS) {
          const title =
            typeof obj.title === "string"
              ? obj.title
              : typeof obj.name === "string"
                ? obj.name
                : undefined;
          return { text, title };
        }
      }
    }
  }
  return null;
}

function flattenLd(value: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const el of v) walk(el);
    } else if (v && typeof v === "object") {
      out.push(v as Record<string, unknown>);
      const graph = (v as Record<string, unknown>)["@graph"];
      if (graph) walk(graph);
    }
  };
  walk(value);
  return out;
}

function isJobPosting(obj: Record<string, unknown>): boolean {
  const t = obj["@type"];
  if (!t) return false;
  if (typeof t === "string") return t === "JobPosting";
  if (Array.isArray(t)) return t.includes("JobPosting");
  return false;
}

// ---------- 2. OpenGraph og:description ----------

export function extractOpenGraph(html: string): JobLdResult | null {
  const desc = metaContent(html, "og:description") ?? metaContent(html, "description");
  if (!desc) return null;
  const title = metaContent(html, "og:title") ?? undefined;
  const text = desc.trim();
  if (text.length < MIN_CHARS) return null;
  return { text, title };
}

function metaContent(html: string, propOrName: string): string | null {
  // Matches both property="og:X" and name="X" variants
  const propRe = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${escapeRegex(propOrName)}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const contentFirstRe = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(propOrName)}["']`,
    "i",
  );
  return html.match(propRe)?.[1] ?? html.match(contentFirstRe)?.[1] ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- 3. Mozilla Readability ----------

export async function extractReadability(html: string, url: string): Promise<JobLdResult | null> {
  try {
    const { JSDOM } = (await import("jsdom")) as JsdomModule;
    const { Readability } = (await import("@mozilla/readability")) as ReadabilityModule;
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.textContent) return null;
    const text = article.textContent.replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) return null;
    return { text, title: article.title ?? undefined };
  } catch {
    return null;
  }
}

// ---------- 4. RSC / Next.js streaming payload ----------

export function extractRscPayload(html: string): JobLdResult | null {
  const fragments: string[] = [];

  const pushPattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (const m of html.matchAll(pushPattern)) {
    const payload = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");

    const childPattern = /"children":"((?:[^"\\]|\\.)*)"/g;
    for (const cm of payload.matchAll(childPattern)) {
      const text = cm[1]
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, c: string) =>
          String.fromCharCode(parseInt(c, 16)),
        )
        .replace(/\\n/g, "\n")
        .trim();
      if (
        text.length >= 3 &&
        text.length < 1000 &&
        !/[{}()=;$]/.test(text) &&
        !text.includes("__") &&
        !text.includes("module") &&
        !text.includes("className") &&
        !text.includes("function") &&
        !text.includes("undefined")
      ) {
        fragments.push(text);
      }
    }

    const htmlPattern = /"__html":"((?:[^"\\]|\\.)*)"/g;
    for (const hm of payload.matchAll(htmlPattern)) {
      let content = hm[1]
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, c: string) =>
          String.fromCharCode(parseInt(c, 16)),
        )
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
      content = htmlToPlainText(content);
      if (content.length > 10) fragments.push(content);
    }
  }

  const deduped = fragments.filter((f, i) => i === 0 || f !== fragments[i - 1]);
  const text = deduped.join("\n").replace(/\s+/g, " ").trim();
  if (text.length < MIN_CHARS) return null;
  const title = deduped.find(
    (f) => f.length > 5 && f.length < 100 && !/^(Home|404|Apply|Open|Something)/.test(f),
  );
  return { text, title };
}

// ---------- 5. Body text fallback ----------

export async function extractBodyText(html: string, url: string): Promise<JobLdResult | null> {
  try {
    const { JSDOM } = (await import("jsdom")) as JsdomModule;
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    for (const tag of doc.querySelectorAll(
      "script, style, noscript, nav, footer, header",
    )) {
      tag.remove();
    }
    const bodyText = doc.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (bodyText.length < MIN_CHARS) return null;
    const titleEl = doc.querySelector("title");
    return { text: bodyText, title: titleEl?.textContent ?? undefined };
  } catch {
    return null;
  }
}
