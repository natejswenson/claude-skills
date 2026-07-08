/**
 * PDF rendering for a tailored résumé — ported from the old pipeline.ts.
 * No LLM, no extraction, no orchestration: given a schema-valid ResumeJSON
 * and a template name, write a PDF. Kept as a plain importable module
 * (rather than inlined in scripts/render.mjs) so it can be unit-tested
 * directly, mirroring lib/validate.ts's split from scripts/validate.mjs.
 */
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStream } from "@react-pdf/renderer";

import { templates, type TemplateName } from "@/lib/templates";
import { ResumeDocument } from "@/components/ResumeDocument";
import type { ResumeJSON as ResumeJSONType } from "@/schemas/resume";

export const TEMPLATE_NAMES = Object.keys(templates) as TemplateName[];
export const DEFAULT_TEMPLATE: TemplateName = "modern";

export function normalizeTemplate(name: string | undefined): TemplateName {
  if (!name) return DEFAULT_TEMPLATE;
  if ((TEMPLATE_NAMES as string[]).includes(name)) return name as TemplateName;
  throw new Error(`unknown_template: ${name} — choose one of ${TEMPLATE_NAMES.join(", ")}`);
}

function sanitizeStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
 * Render a tailored résumé to a PDF in the given template/outDir, deriving
 * a filesystem-safe filename from the résumé's name. Returns the written
 * PDF path.
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
