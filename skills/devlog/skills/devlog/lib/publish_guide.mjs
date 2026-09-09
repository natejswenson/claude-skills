// Strict, additive guide publication. Receipts establish local consistency, not
// independent proof that commands ran or that an author reviewed the result.
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { lintGuide } from './guide_draft.mjs';
import { parseFrontmatter } from './lint_post.mjs';
import { publishEntry } from './publish_entry.mjs';
import { RE_PROJECT_KEY, RE_FINAL_RELEASE } from './core.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'GUIDE_EVIDENCE_INVALID' });
function requireThat(condition, message) { if (!condition) throw fail(message); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function local(base, value) {
  requireThat(text(value) && (isAbsolute(value) || !/^[a-z][a-z\d+.-]*:/i.test(value)), 'Evidence paths must be local filesystem paths');
  return resolve(base, value);
}
function parse(bytes, label) {
  try { const data = JSON.parse(bytes.toString('utf8')); requireThat(data && typeof data === 'object' && !Array.isArray(data), `${label} must be a JSON object`); return data; }
  catch (error) { if (error.code === 'GUIDE_EVIDENCE_INVALID') throw error; throw fail(`${label} must contain valid JSON`); }
}
function checkedFile(base, ref, label) {
  requireThat(ref && /^[a-f\d]{64}$/.test(ref.sha256 ?? ''), `${label} requires a SHA-256`);
  const path = local(base, ref.path);
  const bytes = readFileSync(path);
  requireThat(digest(bytes) === ref.sha256, `${label} hash is stale`);
  return { path, bytes };
}
function report(base, ref, label, articleSha256, agentPromptSha256) {
  const file = checkedFile(base, ref, label);
  const value = parse(file.bytes, label);
  requireThat(value.status === 'passed' && text(value.summary), `${label} must pass with observed summary`);
  requireThat(value.articleSha256 === articleSha256 && value.agentPromptSha256 === agentPromptSha256, `${label} is bound to different article or agent payload bytes`);
  return { value, base: dirname(file.path) };
}
function present(file) {
  try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function assertVacant(cloneDir, project, version) {
  requireThat(existsSync(cloneDir), 'Clone directory does not exist');
  const projectDir = join(cloneDir, project);
  if (present(projectDir)) requireThat(lstatSync(projectDir).isDirectory() && !lstatSync(projectDir).isSymbolicLink(), 'Project directory must be an ordinary directory');
  for (const suffix of ['md', 'png']) {
    requireThat(!present(join(projectDir, `${version}.${suffix}`)), `Guide identity ${project}/${version} is occupied (${suffix}); explicit editorial rewrite is separate`);
  }
  const manifestPath = join(projectDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = parse(readFileSync(manifestPath), 'Manifest');
    requireThat(Array.isArray(manifest.entries), 'Manifest must contain entries');
    requireThat(!manifest.entries.some(entry => entry && (entry.version === version || entry.file === `${version}.md`)), `Guide identity ${project}/${version} is occupied or tombstoned in the manifest`);
  }
}

/** Local preflight followed by existing publishEntry; never commits or pushes.
 * All evidence paths resolve relative to evidencePath; output-log paths resolve
 * relative to their execution report. Missing config mode does not call this API.
 */
export async function publishGuide({ cloneDir, articlePath, evidencePath, coverPath } = {}) {
  try {
    requireThat(text(cloneDir) && text(articlePath) && text(evidencePath), 'cloneDir, articlePath and evidencePath are required');
    const articleBytes = readFileSync(articlePath);
    const markdown = articleBytes.toString('utf8');
    const lint = lintGuide(markdown);
    requireThat(lint.ok, `Guide lint failed: ${lint.findings.map(item => item.rule).join(', ')}`);
    const evidence = parse(readFileSync(evidencePath), 'Evidence');
    const base = dirname(resolve(evidencePath));
    requireThat(evidence.schema === 1, 'Evidence schema must be 1');
    const articleSha256 = digest(articleBytes);
    requireThat(evidence.articleSha256 === articleSha256, 'Article hash is stale');
    const { data } = parseFrontmatter(markdown.replaceAll('\r\n', '\n'));
    const anchor = evidence.anchor;
    requireThat(anchor && typeof anchor.project === 'string' && RE_PROJECT_KEY.test(anchor.project) && !anchor.project.includes('..'), 'Anchor project is invalid');
    requireThat(typeof anchor.version === 'string' && RE_FINAL_RELEASE.test(anchor.version), 'Anchor must identify a final release version');
    requireThat(typeof anchor.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchor.date) && new Date(anchor.date).toISOString().slice(0, 10) === anchor.date, 'Anchor date must be a valid ISO date');
    requireThat(data.project === anchor.project && data.version === anchor.version && String(data.date) === anchor.date, 'Article project/version/date must match the selected anchor');
    const start = '<!-- agent-handoff:start -->', end = '<!-- agent-handoff:end -->';
    const startIndex = markdown.indexOf(start), endIndex = markdown.indexOf(end);
    const block = markdown.slice(startIndex + start.length, endIndex);
    const prompt = /^```text\r?\n([\s\S]*?)\r?\n```\s*$/m.exec(block)[1];
    const reference = markdown.slice(0, startIndex) + markdown.slice(endIndex + end.length);
    const payload = `${prompt}\n\n<reference-guide>\n${reference.trim()}\n</reference-guide>\n`;
    const payloadFile = checkedFile(base, evidence.agentPrompt, 'Agent prompt');
    requireThat(payloadFile.bytes.equals(Buffer.from(payload)), 'Agent prompt does not match the exact handoff/reference payload');
    const agentPromptSha256 = digest(payloadFile.bytes);
    const execution = report(base, evidence.execution, 'Execution report', articleSha256, agentPromptSha256);
    requireThat(Array.isArray(execution.value.commands) && execution.value.commands.length > 0, 'Execution report needs command observations');
    for (const command of execution.value.commands) {
      requireThat(command && text(command.command) && command.exitCode === 0, 'Every execution command must record successful observed completion');
      const output = checkedFile(execution.base, command.output, 'Execution output');
      requireThat(output.bytes.length > 0, 'Execution output cannot be empty');
    }
    const adaptation = report(base, evidence.adaptation, 'Adaptation report', articleSha256, agentPromptSha256).value;
    requireThat(text(adaptation.fixture?.original) && text(adaptation.fixture?.result), 'Adaptation report must identify original and resulting fixtures');
    requireThat(Array.isArray(adaptation.independentChecks) && adaptation.independentChecks.length > 0 && adaptation.independentChecks.every(check => check && text(check.check) && text(check.observation) && check.passed === true), 'Adaptation report needs passing independent checks with observations');
    const review = report(base, evidence.review, 'Review report', articleSha256, agentPromptSha256).value;
    requireThat(text(review.reviewer) && Array.isArray(review.blockingFindings) && review.blockingFindings.length === 0, 'Review report needs a reviewer and no unresolved blocking findings');
    let coverImageBuffer;
    if (coverPath !== undefined) {
      requireThat(text(coverPath), 'coverPath must be a local file');
      coverImageBuffer = readFileSync(coverPath);
      const coverSha256 = digest(coverImageBuffer);
      requireThat(evidence.coverSha256 === coverSha256 && review.coverSha256 === coverSha256 && text(review.coverReview), 'Cover bytes require matching evidence/review hashes and visual observations');
      const image = sharp(coverImageBuffer, { animated: true, limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      requireThat(metadata.format === 'png' && metadata.width === 1600 && metadata.height === 900 && (metadata.pages ?? 1) === 1 && !metadata.isPalette, 'Cover must be a single-frame true-color 1600x900 PNG');
      await image.raw().toBuffer();
    } else requireThat(evidence.coverSha256 === undefined && review.coverSha256 === undefined, 'Evidence references a cover but no coverPath was provided');
    // Final check after async decoding, before any content write. A frozen local
    // snapshot prevents article edits between evidence validation and copyFile.
    assertVacant(cloneDir, anchor.project, anchor.version);
    const staging = mkdtempSync(join(tmpdir(), 'devlog-validated-guide-'));
    try {
      const entryPath = join(staging, 'article.md');
      writeFileSync(entryPath, articleBytes, { flag: 'wx' });
      return { ...publishEntry({ cloneDir, project: anchor.project, version: anchor.version, entryPath, coverImageBuffer }), evidenceValidated: true, articleSha256, agentPromptSha256 };
    } finally { rmSync(staging, { recursive: true, force: true }); }
  } catch (error) {
    if (error.code === 'GUIDE_EVIDENCE_INVALID') throw error;
    throw fail(`Guide publication failed: ${error.message}`);
  }
}
