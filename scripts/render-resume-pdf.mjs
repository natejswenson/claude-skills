#!/usr/bin/env node
/**
 * Render the real ResumeDocument to a PDF on disk for a given template,
 * using the mock-resume fixture. For diagnosing/verifying PDF layout
 * (issue: loose line spacing) without a full Next build or the paywall.
 *
 * Usage:
 *   node --import ./scripts/_tsx-loader.mjs scripts/render-resume-pdf.mjs [template] [outDir]
 *   node --import ./scripts/_tsx-loader.mjs scripts/render-resume-pdf.mjs all docs/pdf-snapshots/after
 */
import { readFileSync, mkdirSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStream } from "@react-pdf/renderer";
import { ResumeDocument } from "../components/ResumeDocument.tsx";

const ALL = [
  "modern",
  "classic",
  "technical",
  "polished",
  "timeline",
  "editorial",
  "spotlight",
];

const arg = process.argv[2] ?? "modern";
const outDir = resolve(process.argv[3] ?? "docs/pdf-snapshots/current");
const templates = arg === "all" ? ALL : [arg];

const resume = JSON.parse(
  readFileSync(resolve("scripts/fixtures/mock-resume.json"), "utf8"),
);

mkdirSync(outDir, { recursive: true });

for (const template of templates) {
  const stream = await renderToStream(
    createElement(ResumeDocument, { resume, template }),
  );
  const outPath = resolve(outDir, `${template}.pdf`);
  await new Promise((res, rej) => {
    const ws = createWriteStream(outPath);
    stream.pipe(ws);
    ws.on("finish", res);
    ws.on("error", rej);
    stream.on("error", rej);
  });
  const { size } = readFileSync(outPath) && (await import("node:fs")).statSync(outPath);
  console.log(`  ${template} -> ${outPath} (${Math.round(size / 1024)}KB)`);
}
console.log(`done: ${templates.length} PDF(s) in ${outDir}`);
