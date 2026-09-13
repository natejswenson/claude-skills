import { ipInCidr } from './providers.mjs';

export function scope(host) {
  const h = String(host).split('%')[0];
  if (['*', '0.0.0.0', '::'].includes(h)) return 'wildcard';
  if (ipInCidr(h, '127.0.0.0/8') || ipInCidr(h, '::1/128')) return 'loopback';
  if (['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', 'fc00::/7', 'fe80::/10', '224.0.0.0/4', 'ff00::/8'].some((c) => ipInCidr(h, c))) return 'local';
  return 'other';
}

export function securitySignals(flow) {
  const observations = [];
  const add = (code, observation, limitation) => observations.push({ code, observation, limitation, source: flow.source });
  if (flow.kind === 'listener' && scope(flow.lhost) !== 'loopback') {
    add('non-loopback-listener', `TCP listener on ${flow.lhost}:${flow.lport}`, 'Bound beyond loopback; firewall and routing determine reachability.');
  }
  if (flow.kind === 'bound' && flow.proto === 'UDP' && scope(flow.lhost) !== 'loopback') {
    add('udp-bind', `UDP bound on ${flow.lhost}:${flow.lport}`, 'No peer observed; does not prove an inbound service or traffic.');
  }
  if (flow.kind === 'connection' && scope(flow.rhost) === 'other') {
    if (['21', '23', '80', '110', '143'].includes(flow.rport)) add('plaintext-service-port', `Peer uses port ${flow.rport}, commonly associated with a plaintext service`, 'Port alone cannot establish application protocol or whether this connection uses encryption.');
    if (['22', '445', '3389', '5900'].includes(flow.rport)) add('remote-access-port', `Peer uses remote access or file sharing port ${flow.rport}`, 'A legitimate administrator or service can use this port. Connection direction is unknown.');
  }
  return observations;
}

export function compareSnapshots(before, after) {
  // Comparing tuples describes observations only: same PID is not proof of
  // process continuity, and per-process nettop counters cannot yield rates here.
  const key = (f) => JSON.stringify([f.pid, f.proto, f.type, f.kind, f.lhost, f.lport, f.rhost, f.rport, f.state]);
  const old = new Map(before.map((f) => [key(f), f]));
  const next = new Map(after.map((f) => [key(f), f]));
  return {
    added: [...next].filter(([k]) => !old.has(k)).map(([, f]) => f),
    closed: [...old].filter(([k]) => !next.has(k)).map(([, f]) => f),
    unchanged: [...next.keys()].filter((k) => old.has(k)).length,
    limitation: 'Added/closed means present in one sample only. Short-lived connections, PID reuse, and traffic between samples are not resolved; no bandwidth rate is inferred.',
  };
}
