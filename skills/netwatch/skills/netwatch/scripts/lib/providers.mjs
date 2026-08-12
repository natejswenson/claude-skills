/**
 * Offline network-block ownership — turns an opaque IP into a readable operator.
 *
 * This is a *factual allocation lookup*, the offline equivalent of asking whois
 * who a netblock is registered to. It is NOT a safety judgment and never
 * changes a flow's known/unrecognized status — "Google" means the address sits
 * in a Google-registered range, nothing about whether the traffic is fine. The
 * table is deliberately partial: a well-known range gets a name, everything else
 * is honestly "unknown network", never guessed.
 *
 * Ranges are the big, stable, widely-documented allocations. They can lag
 * reality — allocations move — so the label is "likely operator", and the one
 * rule (only the user's baseline decides "known") is untouched by any of it.
 */

// [cidr, owner, category] — category drives colour in the report, nothing else.
// categories: infra (a service/cloud), cdn, dns, private (your own networks),
// local (this machine / the LAN), unknown.
const V4 = [
  ['127.0.0.0/8', 'Loopback (this machine)', 'local'],
  ['10.0.0.0/8', 'Private LAN', 'private'],
  ['172.16.0.0/12', 'Private LAN', 'private'],
  ['192.168.0.0/16', 'Private LAN', 'private'],
  ['169.254.0.0/16', 'Link-local', 'local'],
  ['100.64.0.0/10', 'Carrier-grade NAT / Tailscale', 'private'],
  ['224.0.0.0/4', 'Multicast', 'local'],
  // Apple
  ['17.0.0.0/8', 'Apple', 'infra'],
  // Anthropic
  ['160.79.104.0/23', 'Anthropic', 'infra'],
  // Google / GCP
  ['8.8.4.0/24', 'Google DNS', 'dns'],
  ['8.8.8.0/24', 'Google DNS', 'dns'],
  ['34.96.0.0/12', 'Google Cloud', 'infra'],
  ['35.184.0.0/13', 'Google Cloud', 'infra'],
  ['35.190.0.0/15', 'Google Cloud', 'infra'],
  ['130.211.0.0/16', 'Google Cloud', 'infra'],
  ['142.250.0.0/15', 'Google', 'infra'],
  ['172.217.0.0/16', 'Google', 'infra'],
  ['216.58.192.0/19', 'Google', 'infra'],
  // Render
  ['216.24.56.0/22', 'Render', 'infra'],
  // Cloudflare
  ['104.16.0.0/13', 'Cloudflare', 'cdn'],
  ['172.64.0.0/13', 'Cloudflare', 'cdn'],
  ['162.158.0.0/15', 'Cloudflare', 'cdn'],
  ['173.245.48.0/20', 'Cloudflare', 'cdn'],
  ['1.1.1.0/24', 'Cloudflare DNS', 'dns'],
  // Fastly
  ['151.101.0.0/16', 'Fastly', 'cdn'],
  // Microsoft / Azure
  ['20.0.0.0/8', 'Microsoft / Azure', 'infra'],
  ['13.107.0.0/16', 'Microsoft', 'infra'],
  ['40.64.0.0/10', 'Microsoft / Azure', 'infra'],
  // GitHub
  ['140.82.112.0/20', 'GitHub', 'infra'],
  // Amazon
  ['52.94.0.0/22', 'Amazon', 'infra'],
];

function v4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n * 256) + o;
  }
  return n;
}

const V4_PARSED = V4.map(([cidr, owner, category]) => {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const baseInt = v4ToInt(base);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (baseInt & mask) >>> 0, mask, owner, category };
});

/**
 * Is an IPv4 host inside a CIDR like "216.24.56.0/22"? Returns false for
 * anything it cannot parse (IPv6, malformed) — the caller falls back to its
 * other matching forms. This is what lets a baseline entry be written as a
 * CIDR, the same shape the report names networks in.
 */
export function ipInCidr(host, cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) return false;
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const h = v4ToInt(host);
  const b = v4ToInt(base);
  if (h === null || b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((h & mask) >>> 0) === ((b & mask) >>> 0);
}

/**
 * Look up a numeric host string (as captured by `lsof -n`).
 * Returns { owner, category }. Unknown is honest, never a guess.
 */
export function lookupProvider(host) {
  if (!host) return { owner: 'unknown network', category: 'unknown' };

  // IPv6 — only the structural prefixes have stable, meaningful names.
  if (host.includes(':')) {
    const h = host.toLowerCase();
    if (h === '::1') return { owner: 'Loopback (this machine)', category: 'local' };
    if (h.startsWith('fe80:')) return { owner: 'Link-local (the LAN)', category: 'local' };
    if (h.startsWith('ff')) return { owner: 'Multicast', category: 'local' };
    if (h.startsWith('fc') || h.startsWith('fd')) return { owner: 'Private (unique-local)', category: 'private' };
    return { owner: 'unknown network (IPv6)', category: 'unknown' };
  }

  const n = v4ToInt(host);
  if (n === null) return { owner: 'unknown network', category: 'unknown' };
  for (const r of V4_PARSED) {
    if (((n & r.mask) >>> 0) === r.network) return { owner: r.owner, category: r.category };
  }
  return { owner: 'unknown network', category: 'unknown' };
}
