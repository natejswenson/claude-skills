/**
 * Lever adapter — jobs.lever.co/<company>/<uuid>
 * Public JSON endpoint: api.lever.co/v0/postings/<company>/<uuid>
 */

import { htmlToPlainText, MIN_CHARS } from "../parsers.ts";

export interface LeverParams {
  company: string;
  jobId: string;
}

const TIMEOUT_MS = 5000;

export async function fetchFromApi(
  params: LeverParams,
): Promise<{ text: string; title?: string } | null> {
  const apiUrl = `https://api.lever.co/v0/postings/${params.company}/${params.jobId}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const parts: string[] = [];
    if (data.text) parts.push(data.text);
    if (data.categories?.location) parts.push(data.categories.location);
    if (data.categories?.team) parts.push(data.categories.team);

    if (data.descriptionPlain) {
      parts.push(data.descriptionPlain);
    } else if (data.description) {
      parts.push(htmlToPlainText(data.description));
    }

    if (Array.isArray(data.lists)) {
      for (const list of data.lists) {
        if (list.text) parts.push(list.text);
        if (list.content) parts.push(htmlToPlainText(list.content));
      }
    }

    if (data.additional) parts.push(htmlToPlainText(data.additional));

    const text = parts.join("\n").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) return null;
    return { text, title: typeof data.text === "string" ? data.text : undefined };
  } catch {
    return null;
  }
}
