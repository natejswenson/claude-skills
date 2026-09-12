/** Reviewed task contracts. Issue prose is input, never controller authority. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RunError } from './run.mjs';

export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const gitText = (tree, ...args) => execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (message) => { throw new RunError(`task contract: ${message}`); };
const id = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s);
export const safeRelative = (s) => typeof s === 'string' && s.length > 0 && !s.startsWith('/') && !s.includes('\\') && !s.includes('\0') && !s.split('/').some((p) => p === '..' || p === '.' || p === '.git');
export const allowsPath = (paths, file) => paths.some((p) => file === p || p.endsWith('/') && file.startsWith(p));

export function validateContract(value) {
  if (!value || value.schema !== 1) fail('expected schema 1');
  const { criteria, allowedPaths, checks, nonGoals } = value;
  if (!Array.isArray(criteria) || !criteria.length || criteria.some((c) => !id(c.id) || typeof c.description !== 'string' || !c.description.trim())) fail('nonempty criteria with stable IDs and descriptions are required');
  if (new Set(criteria.map((c) => c.id)).size !== criteria.length) fail('duplicate criterion ID');
  if (!Array.isArray(nonGoals) || nonGoals.some((s) => typeof s !== 'string')) fail('nonGoals must be a string array');
  if (!Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.some((s) => !safeRelative(s))) fail('allowedPaths must name repository-relative files or directory prefixes ending in /');
  if (!Array.isArray(checks) || !checks.length) fail('at least one required check is necessary');
  const covered = new Set();
  for (const c of checks) {
    if (!id(c.id) || !['regression', 'test', 'command'].includes(c.type)) fail('each check needs a stable ID and type: regression, test, or command');
    if (!Array.isArray(c.argv) || !c.argv.length || c.argv.some((s) => typeof s !== 'string' || !s || s.includes('\0'))) fail(`${c.id}: argv must be a nonempty string array; shell syntax is not interpolated`);
    if (c.timeoutMs != null && (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > 120000)) fail(`${c.id}: timeoutMs must be 1–120000`);
    if (!Array.isArray(c.criteria) || !c.criteria.length || c.criteria.some((s) => !criteria.some((v) => v.id === s))) fail(`${c.id}: unknown or missing criterion coverage`);
    c.criteria.forEach((s) => covered.add(s));
    if (c.type === 'regression' && (!Array.isArray(c.testFiles) || !c.testFiles.length || c.testFiles.some((s) => !safeRelative(s) || s.endsWith('/') || !allowsPath(allowedPaths, s)))) fail(`${c.id}: regression needs explicit in-scope testFiles to run unchanged against the base`);
  }
  if (new Set(checks.map((c) => c.id)).size !== checks.length) fail('duplicate check ID');
  if (criteria.some((c) => !covered.has(c.id))) fail('every criterion needs at least one required check');
  if (!['docs', 'standard', 'sensitive'].includes(value.risk)) fail('risk must be docs, standard, or sensitive');
  if (value.risk !== 'docs' && !checks.some((c) => c.type === 'regression')) fail('behavioral work requires a regression check');
  if (value.ci != null) {
    if (!['required', 'none'].includes(value.ci.mode)) fail('ci.mode must be required or none');
    if (value.ci.mode === 'none' && (typeof value.ci.reason !== 'string' || !value.ci.reason.trim())) fail('no-CI policy requires an explicit reviewed reason');
    if (value.ci.requiredChecks != null && (!Array.isArray(value.ci.requiredChecks) || !value.ci.requiredChecks.length || value.ci.requiredChecks.some((s) => typeof s !== 'string' || !s.trim()))) fail('ci.requiredChecks must contain check names');
    if (value.ci.mode === 'none' && value.ci.requiredChecks) fail('no-CI policy cannot also require checks');
  }
  if (value.lanes != null) {
    if (typeof value.lanes !== 'object' || Array.isArray(value.lanes) || Object.keys(value.lanes).length < 2) fail('lanes must partition at least two named work items');
    const assigned = new Set();
    for (const [slug, lane] of Object.entries(value.lanes)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !lane || !Array.isArray(lane.criteria) || !Array.isArray(lane.checks) || !Array.isArray(lane.allowedPaths)) fail('invalid lane partition');
      if (lane.criteria.some((id) => !criteria.some((c) => c.id === id)) || lane.checks.some((id) => !checks.some((c) => c.id === id)) || lane.allowedPaths.some((p) => !allowsPath(allowedPaths, p))) fail(`${slug}: partition escapes the approved contract`);
      lane.checks.forEach((id) => assigned.add(id));
      const { lanes, ...base } = value;
      validateContract({ ...base, criteria: criteria.filter((c) => lane.criteria.includes(c.id)), checks: checks.filter((c) => lane.checks.includes(c.id)), allowedPaths: lane.allowedPaths });
    }
    if (checks.some((c) => !assigned.has(c.id))) fail('every required check must be assigned to a lane');
  }
  return structuredClone(value);
}

export function contractForLane(contract, slug) {
  const valid = validateContract(contract);
  if (!valid.lanes) return valid;
  const selected = valid.lanes[slug];
  if (!selected) fail(`no approved obligation partition for lane ${slug}`);
  const { lanes, ...base } = valid;
  return { ...base, criteria: base.criteria.filter((c) => selected.criteria.includes(c.id)), checks: base.checks.filter((c) => selected.checks.includes(c.id)), allowedPaths: selected.allowedPaths };
}

export function contractFromPlan(text) {
  const blocks = [...text.matchAll(/^```issueflow-contract\s*\n([\s\S]*?)^```\s*$/gm)];
  if (blocks.length !== 1) fail('plan must contain exactly one fenced issueflow-contract JSON block');
  let value;
  try { value = JSON.parse(blocks[0][1]); } catch { fail('invalid JSON in issueflow-contract block'); }
  return validateContract(value);
}

/** Extensions are not sufficient: skill instructions and executable config are code. */
export function observedRisk(files, contents = () => '') {
  const sensitive = files.filter((f) => /(?:^|\/)(?:\.github|migrations?|auth|security)(?:\/|\.)|(?:auth|persist|concurren|credential|workflow|deploy|lock)/i.test(f));
  if (sensitive.length) return { kind: 'deep', reason: `sensitive paths: ${sensitive.join(', ')}` };
  const nonDocs = files.filter((f) => !(/(?:^|\/)(?:readme|changelog|license)(?:\.[^/]*)?$|^docs\/.*\.(?:md|txt|rst)$/i.test(f)) || /(?:^|\n)(?:```(?:sh|bash|js|javascript|python|yaml)|.*\b(?:must|never|execute|dispatch)\b)/i.test(contents(f)));
  return nonDocs.length ? { kind: 'standard', reason: `behavioral or unknown scope: ${nonDocs.join(', ')}` } : { kind: 'fast-docs', reason: 'observed prose-only documentation scope' };
}

export function checkScope(tree, base, head, contract) {
  const files = gitText(tree, 'diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
  const outside = files.filter((f) => !allowsPath(contract.allowedPaths, f));
  if (outside.length) fail(`unapproved paths: ${outside.join(', ')}; amend and re-review the plan before verification`);
  const risk = observedRisk(files, (file) => {
    try { return gitText(tree, 'show', `${head}:${file}`); } catch { return ''; }
  });
  if (contract.risk === 'docs' && risk.kind !== 'fast-docs') fail(`${risk.reason}; docs checks cannot authorize behavioral work`);
  return { files, ...risk };
}
