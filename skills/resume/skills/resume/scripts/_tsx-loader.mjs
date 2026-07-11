/**
 * Minimal Node ESM loader: transpiles .ts/.tsx (incl. JSX) on the fly with
 * the installed `typescript`, and resolves the project's `@/` path alias to
 * the repo root. Lets plain node scripts import real .tsx components
 * (e.g. scripts/templates/ResumeDocument.tsx) without a full Next build.
 *
 * Usage: node --import ./scripts/_tsx-loader.mjs scripts/<thing>.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import ts from "typescript";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"];

function tryResolve(base) {
  for (const e of EXTS) {
    try {
      readFileSync(base + e);
      return base + e;
    } catch {}
  }
  for (const e of EXTS) {
    try {
      const idx = pathResolve(base, "index" + e);
      readFileSync(idx);
      return idx;
    } catch {}
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) {
    target = tryResolve(pathResolve(ROOT, specifier.slice(2)));
  } else if (specifier.startsWith(".")) {
    const base = pathResolve(
      dirname(fileURLToPath(context.parentURL)),
      specifier,
    );
    target = tryResolve(base) ?? base;
  }
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.(tsx|ts|jsx)$/.test(url)) {
    const src = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
