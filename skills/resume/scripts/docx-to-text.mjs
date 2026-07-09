#!/usr/bin/env node
/**
 * docx-to-text.mjs — extract plain text from a .docx résumé.
 *
 * The `Read` tool doesn't parse .docx natively (unlike .pdf/.txt/.md), so
 * this small shim recovers DOCX support without reintroducing a full parser
 * tier: the agent runs this once, then reads the resulting text normally.
 * Extracted from the old lib/parsing/resume.ts's mammoth branch.
 *
 * Usage:
 *   node scripts/docx-to-text.mjs <path-to-docx>
 *
 * Prints the extracted plain text to stdout. Exits 1 with an error message
 * on read/parse failure or if the extracted text looks too short to be a
 * real résumé (e.g. a scanned/image-only document mammoth can't recover
 * text from).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mammoth from "mammoth";

const MIN_CHARS = 200;

export async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const normalized = result.value.replace(/\r\n/g, "\n").replace(/ /g, " ").trim();
  if (normalized.length < MIN_CHARS) {
    throw new Error(
      `extracted only ${normalized.length} chars — is this a scanned/image-only document?`,
    );
  }
  return normalized;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/docx-to-text.mjs <path-to-docx>");
    process.exit(2);
  }

  let buffer;
  try {
    buffer = readFileSync(resolve(path));
  } catch (err) {
    console.error(`✖ could not read ${path}: ${err.message ?? err}`);
    process.exit(1);
  }

  try {
    const text = await extractDocxText(buffer);
    console.log(text);
  } catch (err) {
    console.error(`✖ ${err.message ?? err}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
