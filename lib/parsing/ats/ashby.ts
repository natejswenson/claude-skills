/**
 * Ashby adapter — jobs.ashbyhq.com/<company>/<uuid>
 * SPA — job content embedded in `window.__appData.posting` in the HTML.
 */

import { htmlToPlainText, MIN_CHARS } from "../parsers.ts";

const TIMEOUT_MS = 5000;
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

export async function fetchFromApi(
  url: URL,
): Promise<{ text: string; title?: string } | null> {
  try {
    const res = await fetch(url.toString(), {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(/window\.__appData\s*=\s*({.*?});/);
    if (!match) return null;

    const appData = JSON.parse(match[1]);
    const posting = appData?.posting;
    if (!posting?.descriptionHtml) return null;

    const parts: string[] = [];
    if (posting.title) parts.push(posting.title);
    if (posting.departmentName) parts.push(posting.departmentName);
    if (posting.locationName) parts.push(posting.locationName);
    parts.push(htmlToPlainText(posting.descriptionHtml));

    const text = parts.join("\n").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) return null;
    return { text, title: posting.title };
  } catch {
    return null;
  }
}
