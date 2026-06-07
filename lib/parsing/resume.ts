import "@/lib/polyfills/promise-try";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export type ResumeParseResult =
  | { ok: true; text: string }
  | { ok: false; error: "too_short" | "unsupported_type" | "parse_failed" | "too_large"; detail?: string };

const MIN_CHARS = 200;
// Post-extraction cap blocks zip-bomb DOCX and pathological PDFs whose
// uncompressed text expands orders of magnitude beyond the 5 MB upload
// limit. A real resume ≈ 5-30 KB of text.
const MAX_EXTRACTED_CHARS = 500_000;

export async function parseResumeFile(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<ResumeParseResult> {
  try {
    let text = "";

    if (mimeType === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = result.value;
    } else {
      return { ok: false, error: "unsupported_type", detail: mimeType };
    }

    if (text.length > MAX_EXTRACTED_CHARS) {
      return {
        ok: false,
        error: "too_large",
        detail: `Extracted text is ${text.length} chars (max ${MAX_EXTRACTED_CHARS}). Possible zip-bomb or corrupted file.`,
      };
    }

    const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();

    if (normalized.length < MIN_CHARS) {
      return {
        ok: false,
        error: "too_short",
        detail: `Extracted only ${normalized.length} chars. Is this a scanned PDF?`,
      };
    }

    return { ok: true, text: normalized };
  } catch (err) {
    return {
      ok: false,
      error: "parse_failed",
      detail: (err as Error).message,
    };
  }
}
