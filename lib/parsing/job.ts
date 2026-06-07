/**
 * Pipeline orchestrator for job-posting extraction.
 * Thin — all parsing logic lives in `parsers.ts` + `ats/*`.
 * Contract: docs/plans/2026-04-19-extract-job-robust-contract.yaml.
 */

import { classifyUrl, normalizeUrl, STEALTH_REQUIRED_HOSTS } from "./url-classifier.ts";
import {
  extractBodyText,
  extractJsonLd,
  extractOpenGraph,
  extractReadability,
  extractRscPayload,
  MIN_CHARS,
} from "./parsers.ts";
import { fetchFromApi as fetchWorkday } from "./ats/workday.ts";
import { fetchFromApi as fetchLever } from "./ats/lever.ts";
import { fetchFromApi as fetchAshby } from "./ats/ashby.ts";
import { fetchFromApi as fetchSmartRecruiters } from "./ats/smartrecruiters.ts";
import { firecrawlEnabled, firecrawlScrape } from "./firecrawl.ts";
import { safeFetch, assertPublicUrl } from "../url-safety.ts";

export type JobParseResult =
  | { ok: true; text: string; title?: string }
  | {
      ok: false;
      error: "hostile_domain" | "fetch_failed" | "too_short";
      detail?: string;
    };

const FETCH_TIMEOUT_MS = 5000;
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// Status codes that indicate the origin is blocking us — jump straight to Firecrawl
const WAF_STATUSES = new Set([403, 429, 503]);

export async function extractJobFromUrl(rawUrl: string): Promise<JobParseResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "fetch_failed", detail: "Invalid URL" };
  }

  // Punycode / IDN lookalike rejection. `xn--linkdin-gkc.com` (Cyrillic
  // lookalike of linkedin.com) would bypass the static HOSTILE_HOSTS
  // literal-string check. Rejecting all xn-- hosts is strict but
  // legitimate job postings are ASCII-domain in practice.
  if (url.hostname.split(".").some((label) => label.startsWith("xn--"))) {
    return { ok: false, error: "hostile_domain", detail: url.hostname };
  }

  // ---- Canonicalize URL (e.g. Indeed search pages → single-job viewjob) ----
  url = normalizeUrl(url);
  rawUrl = url.toString();

  // ---- Tier 1: Hostile short-circuit ----
  const classification = classifyUrl(url);
  if (classification.kind === "hostile") {
    return {
      ok: false,
      error: "hostile_domain",
      detail: classification.params?.hostname ?? url.hostname,
    };
  }

  // ---- Stealth-required hosts: skip tier 2/3, go straight to Firecrawl stealth ----
  // Indeed/Glassdoor block plain fetch + basic Firecrawl proxy. Only stealth works.
  if (STEALTH_REQUIRED_HOSTS.has(url.hostname)) {
    if (firecrawlEnabled()) {
      const fc = await firecrawlScrape(rawUrl, { stealth: true });
      if (fc) {
        console.log(
          `[extract-job] Firecrawl (stealth) succeeded (${fc.text.length} chars)`,
        );
        return { ok: true, ...fc };
      }
    }
    return {
      ok: false,
      error: "fetch_failed",
      detail: `${url.hostname} requires stealth proxy; ${firecrawlEnabled() ? "Firecrawl returned nothing" : "FIRECRAWL_API_KEY unset"}`,
    };
  }

  // ---- Tier 2: ATS-specific adapter ----
  const atsResult = await dispatchAts(url, classification);
  if (atsResult) {
    console.log(
      `[extract-job] ATS ${classification.kind} succeeded (${atsResult.text.length} chars)`,
    );
    return { ok: true, ...atsResult };
  }

  // ---- Tier 3: Safe fetch + parser chain ----
  // safeFetch re-validates every redirect hop so a 302 from a public host
  // can't chain to an internal IP.
  let html: string | null = null;
  let wafHit = false;
  let fetchErr: string | null = null;
  try {
    const res = await safeFetch(url.toString(), {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (WAF_STATUSES.has(res.status)) {
        wafHit = true;
      } else {
        fetchErr = `HTTP ${res.status}`;
      }
    } else {
      // Cap body at 2 MB to block parser-DoS via pathological HTML
      // (RSC regex + readability on arbitrary-size input).
      const MAX_HTML_BYTES = 2 * 1024 * 1024;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_HTML_BYTES) {
        fetchErr = "response_too_large";
      } else {
        html = new TextDecoder().decode(buf);
      }
    }
  } catch (err) {
    fetchErr = (err as Error).message;
  }

  if (html) {
    // extractReadability / extractBodyText are async (dynamic jsdom import,
    // see parsers.ts). The sync parsers pass through await unchanged.
    for (const [name, fn] of [
      ["json-ld", () => extractJsonLd(html!)],
      ["og", () => extractOpenGraph(html!)],
      ["readability", () => extractReadability(html!, url.toString())],
      ["rsc", () => extractRscPayload(html!)],
      ["body", () => extractBodyText(html!, url.toString())],
    ] as const) {
      const out = await fn();
      if (out && out.text.length >= MIN_CHARS) {
        console.log(`[extract-job] ${name} parser succeeded (${out.text.length} chars)`);
        return { ok: true, ...out };
      }
    }
  }

  // ---- Tier 4: Firecrawl safety net ----
  // Re-assert public URL before spending Firecrawl budget (catches DNS
  // rebinding between entry and this point, and works as belt-and-
  // suspenders if /api/extract-job ever gains another caller that
  // skipped the entry check).
  if (firecrawlEnabled()) {
    try {
      await assertPublicUrl(rawUrl);
    } catch {
      return {
        ok: false,
        error: "fetch_failed",
        detail: "unsafe_url",
      };
    }
    const fc = await firecrawlScrape(rawUrl);
    if (fc) {
      console.log(`[extract-job] Firecrawl succeeded (${fc.text.length} chars)`);
      return { ok: true, ...fc };
    }
  } else {
    console.warn("[extract-job] FIRECRAWL_API_KEY unset — tier-4 disabled");
  }

  // ---- Tier 5: give up ----
  if (fetchErr && !wafHit && !html) {
    return { ok: false, error: "fetch_failed", detail: fetchErr };
  }
  return {
    ok: false,
    error: "too_short",
    detail: wafHit ? "Origin blocked request and Firecrawl unavailable" : "Could not extract job content",
  };
}

async function dispatchAts(
  url: URL,
  c: ReturnType<typeof classifyUrl>,
): Promise<{ text: string; title?: string } | null> {
  switch (c.kind) {
    case "workday":
      return fetchWorkday(url.hostname, c.params as {
        company: string;
        boardName: string;
        jobPath: string;
      });
    case "lever":
      return fetchLever(c.params as { company: string; jobId: string });
    case "ashby":
      return fetchAshby(url);
    case "smartrecruiters":
      return fetchSmartRecruiters(
        c.params as { company: string; jobId: string },
      );
    default:
      return null;
  }
}
