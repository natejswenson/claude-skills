/** Deterministic policy primitives shared by the Codex dispatch paths. */
import { createHash } from 'node:crypto';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function preflightScout({ files = [], issue = '', tests = [], ci = [] } = {}) {
  const paths = files.map((f) => typeof f === 'string' ? f : f.path ?? '');
  const text = `${issue}\n${paths.join('\n')}`.toLowerCase();
  const sensitive = /(auth|permission|credential|secret|security|token|password)/.test(text);
  const operational = /(^|\/)(\.github|workflow|release|deploy|install|migration)/.test(text);
  const scope = paths.length + tests.length + ci.length;
  return { schema: 1, files: paths, estimatedScope: scope < 4 ? 'small' : scope < 12 ? 'medium' : 'large', security: sensitive, operational, tests, ci, unknowns: [], recommendedProfile: sensitive || operational ? 'deep' : scope < 4 ? 'fast-docs' : 'standard' };
}

export function contextCurator({ head, files = [], symbols = [], callers = [], tests = [], constraints = [], unknowns = [] } = {}) {
  const map = { schema: 1, head, files, symbols, callers, tests, constraints, unknowns };
  return { ...map, mapHash: sha(map) };
}

export function verifyCuratorMap(map, head) {
  if (!map || map.schema !== 1 || map.head !== head || typeof map.mapHash !== 'string') return false;
  const { mapHash, ...body } = map;
  return mapHash === sha(body);
}

export function learnedPolicy(history = [], defaults = {}) {
  const valid = history.filter((h) => h && Number.isFinite(h.durationMs) && Number.isFinite(h.findings));
  if (valid.length < 3) return { ...defaults, sampleCount: valid.length, learned: false };
  const avgDuration = valid.reduce((n, h) => n + h.durationMs, 0) / valid.length;
  const avgFindings = valid.reduce((n, h) => n + h.findings, 0) / valid.length;
  return { ...defaults, sampleCount: valid.length, learned: true, durationMultiplier: clamp(avgDuration / 300000, 0.75, 2), expectedFindings: clamp(avgFindings, 0, 50) };
}

export function resetLearnedPolicy() { return { sampleCount: 0, learned: false, durationMultiplier: 1, expectedFindings: 0 }; }

export function stageTimeout(stage, learned = {}) {
  const base = { investigate: 1800, implement: 1800, finder: 900, verifier: 1200, fixer: 1800, fixerEscalated: 2400 }[stage] ?? 1800;
  return Math.round(base * clamp(Number(learned.durationMultiplier) || 1, 0.75, 2));
}

export function testPolicy(files = []) {
  const paths = files.map((f) => typeof f === 'string' ? f : f.path ?? '');
  const text = paths.join('\n').toLowerCase();
  if (/(\.github|workflow|release|deploy|install|auth|permission|migration|checkpoint|persist)/.test(text)) return { level: 'full', reason: 'operational, authentication, persistence, or release surface' };
  if (paths.some((p) => /(^|\/)(src|lib|packages?)\//.test(p))) return { level: 'package', reason: 'shared or production behavior' };
  return { level: 'targeted', reason: 'isolated documentation, formatting, or test-only change' };
}

export function adjudicationNeed(verdicts = []) {
  const conflict = verdicts.some((v) => v.status === 'confirmed') && verdicts.some((v) => v.status === 'refuted');
  const severity = new Set(verdicts.map((v) => v.severity).filter(Boolean)).size > 1;
  const plausible = verdicts.some((v) => v.status === 'plausible');
  return { required: conflict || severity || plausible, reason: conflict ? 'confirmation conflict' : severity ? 'severity disagreement' : plausible ? 'plausible candidate' : null };
}

export function delegationInstructions(host) {
  if (host !== 'codex') return '';
  return 'Parallelize independent investigation, finder, and verifier work; preserve dependency barriers, keep one output per worker, release completed workers promptly, and stop spawning when coverage will not improve. The parent owns state transitions and gates; workers own only their declared output.';
}
