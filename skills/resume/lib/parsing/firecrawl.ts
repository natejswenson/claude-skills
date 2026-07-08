/**
 * Tier-4 Firecrawl client — bypasses Cloudflare / renders JS.
 *
 * If FIRECRAWL_API_KEY is unset, `firecrawlEnabled()` returns false and
 * the pipeline skips this tier silently.
 */

import { MIN_CHARS } from "./parsers.ts";

const ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
// Basic proxy is fast; stealth proxy has to solve Cloudflare's JS challenge
// (including Turnstile on some hosts) + wait for DOM render before the
// scrape starts. We observed ZipRecruiter specifically hitting Firecrawl's
// server-side 408 at 28s — their solver needs more time. 60s client
// budget + 55s server-side budget leaves headroom without blowing past
// the 75s maxDuration on /api/extract-job.
const TIMEOUT_MS_BASIC = 10_000;
const TIMEOUT_MS_STEALTH = 60_000;

export function firecrawlEnabled(): boolean {
  return typeof process.env.FIRECRAWL_API_KEY === "string"
    && process.env.FIRECRAWL_API_KEY.length > 0;
}

export async function firecrawlScrape(
  url: string,
  opts: { stealth?: boolean } = {},
): Promise<{ text: string; title?: string } | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  const reqBody: Record<string, unknown> = {
    url,
    // Request markdown AND html — we prefer markdown but fall back to
    // html→text if markdown comes back empty (observed on ZipRecruiter
    // where the challenge-solved page left Firecrawl's markdown extractor
    // with nothing).
    formats: opts.stealth ? ["markdown", "html"] : ["markdown"],
    // onlyMainContent=true occasionally over-strips challenge-solved pages
    // (the anti-bot wrapper's DOM structure confuses the "main content"
    // heuristic). Disable it in stealth mode; we have MIN_CHARS as the
    // floor so a bit of nav chrome in the text is acceptable.
    onlyMainContent: !opts.stealth,
    waitFor: opts.stealth ? 8000 : 2000,
  };
  // Stealth proxy ($0.025 vs $0.005) — required for hosts with advanced bot
  // detection like Indeed / Glassdoor / ZipRecruiter where the basic proxy
  // returns 403. Firecrawl's `timeout` param is the server-side ceiling;
  // must be a touch below our client-side AbortSignal so the Firecrawl
  // response still lands (not racing with the client abort).
  if (opts.stealth) {
    reqBody.proxy = "stealth";
    reqBody.timeout = 55_000;
  }

  const clientTimeoutMs = opts.stealth ? TIMEOUT_MS_STEALTH : TIMEOUT_MS_BASIC;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(clientTimeoutMs),
    });
    if (!res.ok) {
      console.warn(`[extract-job] Firecrawl HTTP ${res.status}`);
      return null;
    }

    const resBody = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: {
        markdown?: string;
        html?: string;
        metadata?: { title?: string };
      };
    };

    if (!resBody.success) {
      console.warn(
        `[extract-job] Firecrawl success:false err=${resBody.error ?? "?"}`,
      );
      return null;
    }
    const title = resBody.data?.metadata?.title;

    // Primary: Firecrawl's own markdown extraction.
    const markdown = resBody.data?.markdown?.trim() ?? "";
    if (markdown.length >= MIN_CHARS) {
      return { text: markdown, title };
    }

    // Fallback: strip tags from the raw HTML. Only fires when markdown
    // was empty/too-short — happens on pages whose structure confuses
    // Firecrawl's markdown extractor (observed on ZipRecruiter).
    const html = resBody.data?.html;
    if (html) {
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped.length >= MIN_CHARS) {
        console.log(
          `[extract-job] Firecrawl html-fallback (${stripped.length} chars)`,
        );
        return { text: stripped, title };
      }
      console.warn(
        `[extract-job] Firecrawl html too short after strip: ${stripped.length} chars`,
      );
      return null;
    }

    console.warn(
      `[extract-job] Firecrawl markdown too short: ${markdown.length} chars, no html fallback`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[extract-job] Firecrawl failed: ${(err as Error).message.slice(0, 200)}`,
    );
    return null;
  }
}
