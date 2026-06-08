/**
 * Polyfill for Promise.try (Stage 4, shipped in Node 22.5+).
 *
 * Vercel's "nodejs22.x" runtime has been observed running Node 22.x patches
 * older than 22.5, where Promise.try is undefined. unpdf@1.6.0 uses
 * Promise.try inside its bundled pdf.js — calling it produces an
 * unhandled-rejection TypeError that hangs the lambda for the full
 * maxDuration (300s) before the runtime kills it. See issue #59.
 *
 * This module patches Promise.try at module load. Import it at the TOP of
 * any file that imports unpdf, so the polyfill is in place before unpdf's
 * top-level code runs (ES module imports execute in source order).
 */

if (typeof (Promise as unknown as { try?: unknown }).try !== "function") {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try = function (
    fn: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}
