/**
 * End-to-end tailoring pipeline for the onetapresume skill.
 *
 * Mirrors the web app's /api/generate + /api/extract-job + /api/pdf routes,
 * collapsed into a single local function with no HTTP, paywall, Turnstile,
 * or rate-limiting. The non-deterministic step (LLM tailoring) goes through
 * the shared LLM adapter so the eval harness exercises the exact same path.
 */
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream, existsSync, statSync, readFileSync } from "node:fs";
import { extname, resolve, join, basename } from "node:path";
import { createElement } from "react";
import { renderToStream } from "@react-pdf/renderer";

import { getLLMClient } from "@/lib/llm";
import { parseResumeFile } from "@/lib/parsing/resume";
import { extractJobFromUrl } from "@/lib/parsing/job";
import { SYSTEM_PROMPT, buildUserMessage, RESUME_JSON_SCHEMA } from "@/lib/prompt";
import { ResumeJSON, type ResumeJSON as ResumeJSONType } from "@/schemas/resume";
import { templates, type TemplateName } from "@/lib/templates";
import { ResumeDocument } from "@/components/ResumeDocument";
import { logInfo, logWarn } from "@/lib/log";

// Match the web app's input caps so behavior is 1:1.
const MAX_JOB_CHARS = 200_000;
const MAX_RESUME_CHARS = 15_000;
const MAX_JOB_CHARS_TRIMMED = 6_000;

export const TEMPLATE_NAMES = Object.keys(templates) as TemplateName[];
export const DEFAULT_TEMPLATE: TemplateName = "modern";

// ---------------------------------------------------------------------------
// Job text trimming — ported verbatim from app/api/generate/route.ts so the
// LLM sees the same trimmed input the production site sends.
// ---------------------------------------------------------------------------
export function trimJobText(text: string): string {
  const boilerplatePatterns = [
    /(?:^|\n)\s*(?:equal\s+(?:opportunity|employment)|eeo\b|we\s+are\s+an?\s+equal|diversity\s+(?:and|&)\s+inclusion|accommodation|ada\s+statement)[\s\S]{0,1500}?(?=\n\s*(?:[A-Z][a-z]|$))/gi,
    /(?:^|\n)\s*(?:benefits|perks|what\s+we\s+offer|compensation\s+(?:and|&)\s+benefits|our\s+benefits|total\s+rewards)[\s\S]{0,2000}?(?=\n\s*(?:[A-Z][a-z]|$))/gi,
    /(?:^|\n)\s*(?:about\s+(?:us|the\s+company|our\s+company)|company\s+(?:overview|description|info)|who\s+we\s+are)[\s\S]{0,1500}?(?=\n\s*(?:(?:what|key|core|minimum|required|preferred|responsibilities|qualifications|requirements|role|job|position)\b|$))/gi,
  ];
  let trimmed = text;
  for (const pattern of boilerplatePatterns) trimmed = trimmed.replace(pattern, "\n");
  trimmed = trimmed.replace(/\n{3,}/g, "\n\n").trim();
  if (trimmed.length > MAX_JOB_CHARS_TRIMMED) trimmed = trimmed.slice(0, MAX_JOB_CHARS_TRIMMED);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Resume loading
// ---------------------------------------------------------------------------
export function mimeFromPath(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    case ".md":
    case ".markdown":
      return "text/markdown";
    default:
      return null;
  }
}

export async function loadResumeText(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`resume_not_found: ${path}`);
  const mime = mimeFromPath(path);
  if (!mime) {
    throw new Error(
      `unsupported_resume_type: ${extname(path) || "(no extension)"} — use PDF, DOCX, TXT, or MD`,
    );
  }
  const buf = await readFile(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseResumeFile(ab, mime);
  if (!parsed.ok) {
    throw new Error(`resume_parse_failed: ${parsed.error}${parsed.detail ? ` — ${parsed.detail}` : ""}`);
  }
  return parsed.text.length > MAX_RESUME_CHARS ? parsed.text.slice(0, MAX_RESUME_CHARS) : parsed.text;
}

// ---------------------------------------------------------------------------
// Job resolution: URL → extraction waterfall, file path → read, else literal.
// ---------------------------------------------------------------------------
export async function resolveJobText(
  jobInput: string,
): Promise<{ text: string; title?: string; source: "url" | "file" | "text" }> {
  if (/^https?:\/\//i.test(jobInput.trim())) {
    const r = await extractJobFromUrl(jobInput.trim());
    if (!r.ok) throw new Error(`job_extract_failed: ${r.error}${r.detail ? ` — ${r.detail}` : ""}`);
    return { text: r.text, title: r.title, source: "url" };
  }
  // A path to a text file with the JD?
  if (jobInput.length < 1024 && existsSync(jobInput) && statSync(jobInput).isFile()) {
    return { text: readFileSync(jobInput, "utf-8"), source: "file" };
  }
  return { text: jobInput, source: "text" };
}

// ---------------------------------------------------------------------------
// Tailoring — schema-validated structured output with one corrective retry.
// Ported from the generate route's streamTailorPipeline (non-streaming).
// ---------------------------------------------------------------------------
export async function tailorResume(
  resumeText: string,
  jobText: string,
  opts: { model?: string } = {},
): Promise<ResumeJSONType> {
  // MOCK path: $0 wiring test. Returns the fixed mock-resume fixture.
  if (process.env.MOCK_LLM === "1") {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), "scripts/fixtures/mock-resume.json"), "utf-8"),
    );
    const parsed = ResumeJSON.safeParse(raw);
    if (!parsed.success) throw new Error("mock_resume_invalid");
    return parsed.data;
  }

  if (jobText.length > MAX_JOB_CHARS) throw new Error("job_text_too_long");

  const llm = getLLMClient();
  const user = buildUserMessage(resumeText, trimJobText(jobText));

  // Attempt 1
  const out1 = await llm.completeStructured({
    system: SYSTEM_PROMPT,
    user,
    schema: RESUME_JSON_SCHEMA,
    model: opts.model,
  });
  let v = ResumeJSON.safeParse(out1);
  if (v.success) return v.data;

  // Attempt 2 — corrective retry naming the exact validation failures.
  const issues = v.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  logWarn("tailor_retry", { reason: issues.slice(0, 200) });
  const retrySystem = `${SYSTEM_PROMPT}\n\n# RETRY\n\nYour previous response failed validation with these issues: ${issues}. Fix exactly those issues and return the corrected JSON. Do not change anything else.`;
  const out2 = await llm.completeStructured({
    system: retrySystem,
    user,
    schema: RESUME_JSON_SCHEMA,
    model: opts.model,
  });
  v = ResumeJSON.safeParse(out2);
  if (v.success) return v.data;

  throw new Error(`schema_validation_failed: ${issues}`);
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------
export function normalizeTemplate(name: string | undefined): TemplateName {
  if (!name) return DEFAULT_TEMPLATE;
  if ((TEMPLATE_NAMES as string[]).includes(name)) return name as TemplateName;
  throw new Error(`unknown_template: ${name} — choose one of ${TEMPLATE_NAMES.join(", ")}`);
}

export async function renderResumePdf(
  resume: ResumeJSONType,
  template: TemplateName,
  outPath: string,
): Promise<void> {
  const stream = await renderToStream(createElement(ResumeDocument, { resume, template }));
  await new Promise<void>((res, rej) => {
    const ws = createWriteStream(outPath);
    stream.pipe(ws);
    ws.on("finish", () => res());
    ws.on("error", rej);
    stream.on("error", rej);
  });
}

// ---------------------------------------------------------------------------
// Diff: human-readable summary of what the tailoring changed.
// ---------------------------------------------------------------------------
export interface TailorDiff {
  totalBullets: number;
  optimizedCount: number;
  droppedCount: number;
  keptCount: number;
  roles: number;
  optimized: { role: string; original: string; rewritten: string }[];
  dropped: string[];
}

export function buildDiff(resume: ResumeJSONType): TailorDiff {
  const liveBullets = resume.experience.reduce((n, r) => n + r.bullets.length, 0);
  const optimizedCount = resume.optimizedBullets.length;
  const droppedCount = resume.droppedBullets.length;
  return {
    totalBullets: liveBullets + droppedCount,
    optimizedCount,
    droppedCount,
    keptCount: Math.max(0, liveBullets - optimizedCount),
    roles: resume.experience.length,
    optimized: resume.optimizedBullets.map((b) => ({
      role: b.role,
      original: b.original,
      rewritten: b.rewritten,
    })),
    dropped: resume.droppedBullets.slice(),
  };
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------
export interface PipelineInput {
  resumePath: string;
  jobInput: string;
  template?: string;
  outDir?: string;
  pdfOnly?: boolean;
  model?: string;
}

export interface PipelineResult {
  resume: ResumeJSONType;
  template: TemplateName;
  pdfPath: string;
  jsonPath: string | null;
  diff: TailorDiff;
  jobSource: "url" | "file" | "text";
  jobTitle?: string;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const template = normalizeTemplate(input.template);
  const outDir = resolve(input.outDir ?? "onetap-out");

  logInfo("pipeline_start", { resume: basename(input.resumePath), template });
  const resumeText = await loadResumeText(input.resumePath);
  const job = await resolveJobText(input.jobInput);
  const resume = await tailorResume(resumeText, job.text, { model: input.model });

  await mkdir(outDir, { recursive: true });
  const stem = sanitizeStem(resume.name) || "resume";
  const pdfPath = join(outDir, `${stem}-${template}.pdf`);
  await renderResumePdf(resume, template, pdfPath);

  let jsonPath: string | null = null;
  if (!input.pdfOnly) {
    jsonPath = join(outDir, `${stem}.json`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(jsonPath, JSON.stringify(resume, null, 2), "utf-8");
  }

  return {
    resume,
    template,
    pdfPath,
    jsonPath,
    diff: buildDiff(resume),
    jobSource: job.source,
    jobTitle: job.title,
  };
}

function sanitizeStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
