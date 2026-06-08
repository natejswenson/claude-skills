/**
 * SmartRecruiters adapter — jobs.smartrecruiters.com/<company>/<jobId>
 * Public JSON endpoint: api.smartrecruiters.com/v1/companies/<company>/postings/<jobId>
 */

import { htmlToPlainText, MIN_CHARS } from "../parsers.ts";

export interface SmartRecruitersParams {
  company: string;
  jobId: string;
}

const TIMEOUT_MS = 5000;

export async function fetchFromApi(
  params: SmartRecruitersParams,
): Promise<{ text: string; title?: string } | null> {
  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${params.company}/postings/${params.jobId}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const parts: string[] = [];
    if (data.name) parts.push(data.name);
    if (data.location?.city) parts.push(data.location.city);

    const sections = data.jobAd?.sections ?? {};
    for (const key of [
      "jobDescription",
      "qualifications",
      "additionalInformation",
      "companyDescription",
    ]) {
      const sec = sections[key];
      if (sec?.text) parts.push(htmlToPlainText(sec.text));
    }

    const text = parts.join("\n").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) return null;
    return { text, title: data.name };
  } catch {
    return null;
  }
}
