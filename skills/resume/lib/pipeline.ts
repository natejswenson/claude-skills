/**
 * End-to-end tailoring pipeline for the resume skill.
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
import { validateTailoring, dropNoopOptimizedBullets } from "@/lib/validate";
import { summaryScopedOnly, fixSummaryOnly } from "@/lib/summary-fix";
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
/**
 * Minimal progress sink the pipeline reports phases through. The CLI's
 * `Progress` class satisfies this shape; eval/tests pass nothing and get the
 * silent no-op default.
 */
export interface RunReporter {
  start(label: string): void;
  update(detail: string): void;
  succeed(label?: string): void;
  fail(label?: string): void;
}

const SILENT_REPORTER: RunReporter = {
  start() {},
  update() {},
  succeed() {},
  fail() {},
};

export async function tailorResume(
  resumeText: string,
  jobText: string,
  opts: { model?: string; onProgress?: (p: { outChars: number }) => void } = {},
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

  // Bounded correction loop. Each pass either fixes a schema failure or a
  // deterministic content violation (the audits moved out of the prompt into
  // lib/validate.ts). With thinking disabled each call is ~10–40s, so up to
  // MAX_ATTEMPTS passes stay well within a reasonable wall time. We return the
  // first clean result, or the last schema-valid one if we run out of passes.
  const MAX_ATTEMPTS = 2;
  let system = SYSTEM_PROMPT;
  let lastValid: ResumeJSONType | null = null;
  let lastSchemaIssues = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const out = await llm.completeStructured({
      system,
      user,
      schema: RESUME_JSON_SCHEMA,
      model: opts.model,
      onProgress: opts.onProgress,
    });

    const parsed = ResumeJSON.safeParse(out);
    if (!parsed.success) {
      lastSchemaIssues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logWarn("tailor_retry", { kind: "schema", reason: lastSchemaIssues.slice(0, 200) });
      system = `${SYSTEM_PROMPT}\n\n# RETRY\n\nYour previous response failed validation with these issues: ${lastSchemaIssues}. Fix exactly those issues and return the corrected JSON. Do not change anything else.`;
      continue;
    }

    // Deterministically drop noop "optimized" bullets (rewritten === original)
    // before validating — a free correctness/clarity fix, no LLM round-trip.
    const cleaned = dropNoopOptimizedBullets(parsed.data);
    lastValid = cleaned;
    const check = validateTailoring(cleaned, resumeText);
    if (check.ok) return cleaned;

    // Fast path: when every violation is summary-scoped, fix ONLY the summary
    // with a small, focused call instead of regenerating the whole résumé. This
    // is much cheaper (a one-sentence output vs a full re-emit, on a tiny prompt)
    // and safer (the valid bullets/roles/numbers are untouched). Falls back to
    // the full corrective retry below if it can't produce a clean summary.
    if (summaryScopedOnly(check.violations)) {
      logWarn("tailor_retry", { kind: "summary-fix", reason: check.violations.join("; ").slice(0, 200) });
      const fixed = await fixSummaryOnly(llm, cleaned, resumeText, check.violations, opts.model);
      if (fixed) return fixed;
    }

    logWarn("tailor_retry", { kind: "content", reason: check.violations.join("; ").slice(0, 200) });
    system = `${SYSTEM_PROMPT}\n\n# CORRECTIONS\n\nYour previous output violated these hard constraints: ${check.violations.join("; ")}. Fix exactly these and re-emit the full corrected JSON. Change nothing else.`;
  }

  // Ran out of passes: prefer the last schema-valid result (best effort) over
  // failing the whole run; only throw if we never got valid JSON at all.
  if (lastValid) return lastValid;
  throw new Error(`schema_validation_failed: ${lastSchemaIssues || "no valid JSON produced"}`);
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

/**
 * Re-render an already-tailored résumé in a different template. Cheap (~1s) —
 * no parsing, job extraction, or LLM call — so the style picker can switch
 * looks instantly. Returns the written PDF path.
 */
export async function renderTemplateFromResume(
  resume: ResumeJSONType,
  template: TemplateName,
  outDir: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const stem = sanitizeStem(resume.name) || "resume";
  const pdfPath = join(outDir, `${stem}-${template}.pdf`);
  await renderResumePdf(resume, template, pdfPath);
  return pdfPath;
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
  /** Optional live-progress sink. Defaults to silent. */
  reporter?: RunReporter;
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
  const report = input.reporter ?? SILENT_REPORTER;

  logInfo("pipeline_start", { resume: basename(input.resumePath), template });

  report.start("Parsing résumé");
  const resumeText = await loadResumeText(input.resumePath);
  report.succeed(`Parsed résumé (${resumeText.length.toLocaleString()} chars)`);

  report.start("Resolving job posting");
  const job = await resolveJobText(input.jobInput);
  report.succeed(`Job ready${job.title ? `: ${job.title}` : ` (${job.source})`}`);

  report.start("Tailoring with Claude");
  const resume = await tailorResume(resumeText, job.text, {
    model: input.model,
    onProgress: ({ outChars }) =>
      report.update(`generating… ${outChars.toLocaleString()} chars`),
  });
  report.succeed(
    `Tailored: ${resume.optimizedBullets.length} optimized · ${resume.droppedBullets.length} dropped`,
  );

  report.start(`Rendering ${template} PDF`);
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
  report.succeed("PDF rendered");

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
