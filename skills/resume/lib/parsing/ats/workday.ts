/**
 * Workday adapter — *.wd{N}.myworkdayjobs.com
 * Public JSON endpoint: /wday/cxs/{company}/{boardName}/job/{path}
 */

import { htmlToPlainText, MIN_CHARS } from "../parsers.ts";

export interface WorkdayParams {
  company: string;
  boardName: string;
  jobPath: string;
}

const TIMEOUT_MS = 5000;

export async function fetchFromApi(
  hostname: string,
  params: WorkdayParams,
): Promise<{ text: string; title?: string } | null> {
  const apiUrl = `https://${hostname}/wday/cxs/${params.company}/${params.boardName}/job/${params.jobPath}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const info = data?.jobPostingInfo;
    if (!info?.jobDescription) return null;

    const desc = htmlToPlainText(info.jobDescription);
    const parts = [info.title, info.location, desc].filter(Boolean);
    const text = parts.join("\n").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS) return null;
    return { text, title: info.title };
  } catch {
    return null;
  }
}
