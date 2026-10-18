/**
 * Conservative sender selection, not sender authentication.
 * Parse the whole supported mailbox; never recover a plausible suffix.
 */
const controls = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const atom = "[a-z0-9!#$%&'*+/=?^_" + String.fromCharCode(96) + "{|}~-]+";
const localPart = new RegExp('^' + atom + '(?:\\.' + atom + ')*$', 'i');

export function parseDomain(value) {
  if (typeof value !== 'string' || controls.test(value)) return null;
  if (!/^[a-z0-9.-]+$/i.test(value.trim())) return null;
  const domain = value.trim().toLowerCase();
  if (!domain || domain.length > 253) return null;
  const labels = domain.split('.');
  if (labels.some((l) => l.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l))) return null;
  return domain;
}

/** Rule values accept only a bare ASCII dot-atom mailbox. */
export function parseAddress(value) {
  if (typeof value !== 'string' || controls.test(value)) return null;
  const address = value.trim();
  const parts = address.split('@');
  if (parts.length !== 2 || parts[0].length > 64 || !localPart.test(parts[0])) return null;
  // Whitespace surrounding a domain is allowed in domain configuration, not inside an address.
  if (parts[1] !== parts[1].trim()) return null;
  const domain = parseDomain(parts[1]);
  if (!domain || address.length > 254) return null;
  return { address: address.toLowerCase(), domain };
}

/** Bare address or one complete display-name <address> form. */
export function parseSender(value) {
  if (typeof value !== 'string' || controls.test(value)) return null;
  const sender = value.trim();
  const bare = parseAddress(sender);
  if (bare) return bare;
  const form = /^(.*?)<([^<>]+)>$/.exec(sender);
  if (!form) return null;
  const name = form[1].trim();
  // Quoted display names can contain commas and escaped printable characters.
  // Unquoted names cannot contain RFC structural punctuation or another mailbox.
  if (name.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\[ -~])*"$/.test(name)) return null;
  } else if (/[()<>,;:@[\]"\\]/.test(name)) return null;
  if (form[2] !== form[2].trim()) return null;
  return parseAddress(form[2]);
}

/**
 * Missing evidence contributes no sender. Any supplied marker is non-authorizing,
 * even malformed markers: normalizing them can only produce bounded true.
 */
export function resolveSender(...sources) {
  let mailbox = null;
  let ambiguous = false;
  for (const source of sources) {
    if (Object.hasOwn(source ?? {}, 'senderAmbiguous')) ambiguous = true;
    if (source?.from === undefined || source.from === null) continue;
    const parsed = parseSender(source.from);
    if (!parsed) ambiguous = true;
    else if (mailbox && mailbox.address !== parsed.address) ambiguous = true;
    else mailbox = parsed;
  }
  return { address: ambiguous ? null : mailbox?.address ?? null,
    domain: ambiguous ? null : mailbox?.domain ?? null, ambiguous };
}
