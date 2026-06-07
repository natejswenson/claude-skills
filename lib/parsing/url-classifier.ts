/**
 * URL classifier — pure function, no I/O.
 *
 * Given a job-posting URL, identify which ATS (if any) produced it so we can
 * dispatch to the right tier-2 adapter. Also catches hostile hosts so we can
 * short-circuit before any fetch.
 */

export type AtsKind =
  | "workday"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "hostile"
  | "unknown";

export interface ClassifyResult {
  kind: AtsKind;
  /** Adapter-specific extracted parameters (company, jobId, boardName, etc.). */
  params?: Record<string, string>;
}

const HOSTILE_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
]);

/**
 * Hosts that block basic scrapers (403/Security Check) but are reachable via
 * Firecrawl's stealth proxy. These skip tier 2/3 and go straight to tier 4
 * with `stealth: true` in job.ts.
 *
 * ziprecruiter.com sits behind Cloudflare's "Just a moment…" interstitial
 * which returns 403 on plain fetch. Basic Firecrawl proxy likely hits the
 * same challenge; stealth unlocks it.
 */
export const STEALTH_REQUIRED_HOSTS = new Set([
  "indeed.com",
  "www.indeed.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
]);

/**
 * Canonicalize known job-board URLs so we scrape the single posting rather
 * than a listings page or a tracking-bloated variant.
 *
 * Currently handles Indeed: both `/viewjob?jk=<id>` and search pages like
 * `/q-foo-l-remote-jobs.html?vjk=<id>` are rewritten to the minimal
 * `/viewjob?jk=<id>` form.
 */
export function normalizeUrl(u: URL): URL {
  if (u.hostname === "www.indeed.com" || u.hostname === "indeed.com") {
    const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
    if (jk) {
      const canonical = new URL(`https://${u.hostname}/viewjob`);
      canonical.searchParams.set("jk", jk);
      return canonical;
    }
  }
  return u;
}

export function classifyUrl(u: URL): ClassifyResult {
  const host = u.hostname;

  // Hostile — short-circuit
  if (HOSTILE_HOSTS.has(host)) {
    return { kind: "hostile", params: { hostname: host } };
  }

  // Workday: *.wd{N}.myworkdayjobs.com/<locale>/<boardName>/job/<path>
  const wdMatch = host.match(/^(.+)\.wd\d+\.myworkdayjobs\.com$/);
  if (wdMatch) {
    const company = wdMatch[1];
    const pathMatch = u.pathname.match(
      /\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)/,
    );
    if (pathMatch) {
      return {
        kind: "workday",
        params: { company, boardName: pathMatch[1], jobPath: pathMatch[2] },
      };
    }
  }

  // Lever: jobs.lever.co/<company>/<uuid>
  if (host === "jobs.lever.co") {
    const m = u.pathname.match(/^\/([^/]+)\/([a-f0-9-]+)/);
    if (m) return { kind: "lever", params: { company: m[1], jobId: m[2] } };
  }

  // Ashby: jobs.ashbyhq.com/<company>/<uuid>
  if (host === "jobs.ashbyhq.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([a-f0-9-]+)/);
    if (m) return { kind: "ashby", params: { company: m[1], jobId: m[2] } };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<company>/<jobId>
  // jobId is typically a long numeric string
  if (host === "jobs.smartrecruiters.com") {
    const m = u.pathname.match(/^\/([^/]+)\/(\d+)/);
    if (m) return { kind: "smartrecruiters", params: { company: m[1], jobId: m[2] } };
  }

  return { kind: "unknown" };
}
