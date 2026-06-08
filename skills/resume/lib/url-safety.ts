/**
 * SSRF defense for user-supplied URLs.
 *
 * `assertPublicUrl` rejects non-http(s) schemes and any hostname that
 * resolves (or already is) a private/link-local/loopback IP. `safeFetch`
 * wraps that check around an upstream request and re-applies it on every
 * redirect hop, so a public 302 → 169.254.169.254 chain doesn't bypass
 * the entry check.
 *
 * Covers: AWS/GCP/Azure instance metadata, RFC1918, 127/8, 169.254/16
 * link-local, loopback, ULA. Best-effort — DNS rebinding mid-fetch is
 * still possible; for stronger defense we'd need to pin a resolved IP
 * through a custom undici Agent, but the current design eliminates the
 * straightforward exploits flagged in the security audit.
 */

import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;

// IPv4 private + reserved CIDRs as (base, mask) pairs (big-endian uint32).
const PRIVATE_IPV4: [number, number][] = [
  [0x00000000, 0xff000000], // 0.0.0.0/8
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0x64400000, 0xffc00000], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0xff000000], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  [0xe0000000, 0xf0000000], // 224.0.0.0/4 multicast
  [0xf0000000, 0xf0000000], // 240.0.0.0/4 reserved
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → reject
  return PRIVATE_IPV4.some(([base, mask]) => (n & mask) === base);
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

export type UrlSafetyError =
  | "invalid_url"
  | "unsupported_scheme"
  | "dns_unresolvable"
  | "private_ip";

export async function assertPublicUrl(urlString: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error("invalid_url" satisfies UrlSafetyError);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("unsupported_scheme" satisfies UrlSafetyError);
  }
  const host = u.hostname;
  const kind = net.isIP(host);
  if (kind === 4) {
    if (isPrivateIPv4(host)) throw new Error("private_ip" satisfies UrlSafetyError);
    return;
  }
  if (kind === 6) {
    if (isPrivateIPv6(host)) throw new Error("private_ip" satisfies UrlSafetyError);
    return;
  }
  // Offline seam: the hosted web app needs DNS pinning as an SSRF gate
  // against untrusted multi-tenant traffic. This skill is a single-user
  // local CLI tool fetching a job URL the user typed — the DNS round-trip
  // is fetch hygiene, not a security boundary (see plan). Setting
  // ONETAP_SKIP_DNS_CHECK=1 skips ONLY the network resolution step; the
  // scheme check and literal private-IP rejection above still apply. The
  // offline fixture harness sets this so tests never depend on real DNS.
  if (process.env.ONETAP_SKIP_DNS_CHECK === "1") return;

  // Hostname: resolve both families; reject if any answer is private.
  let addrs4: string[] = [];
  let addrs6: string[] = [];
  await Promise.allSettled([
    dns.resolve4(host).then((a) => (addrs4 = a)).catch(() => {}),
    dns.resolve6(host).then((a) => (addrs6 = a)).catch(() => {}),
  ]);
  if (addrs4.length === 0 && addrs6.length === 0) {
    throw new Error("dns_unresolvable" satisfies UrlSafetyError);
  }
  for (const ip of addrs4) if (isPrivateIPv4(ip)) throw new Error("private_ip" satisfies UrlSafetyError);
  for (const ip of addrs6) if (isPrivateIPv6(ip)) throw new Error("private_ip" satisfies UrlSafetyError);
}

/**
 * Fetch that validates every hop. Pass only user-supplied URLs through
 * this; for your own trusted endpoints (Firecrawl, Stripe) use plain
 * fetch.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}
