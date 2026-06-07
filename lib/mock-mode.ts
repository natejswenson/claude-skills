/**
 * Client-side MOCK bypass predicate (issue #73).
 *
 * The server's /api/generate returns a mock stream BEFORE any Turnstile /
 * rate-limit / payment gate when `MOCK_LLM === "1" && NODE_ENV !==
 * "production"` (see app/api/generate/route.ts:167). The client, however,
 * hard-blocks the request at the Turnstile gate, so headless automation
 * (where the dev-key widget callback races the submit click) can never
 * reach the mock path. This predicate applies the SAME raw `NODE_ENV !==
 * "production"` test the server uses, so the client and server mock
 * decisions cannot diverge.
 *
 * Note: this is NOT the codebase's canonical prod-detection. lib/env.ts
 * uses VERCEL_ENV to treat Vercel *preview* deploys as non-prod (for
 * dev-key selection). Both mock guards instead key off raw NODE_ENV, which
 * is "production" on ALL Vercel builds including previews — so the mock
 * bypass is OFF on previews too. That is the safer behavior here (previews
 * are internet-reachable); the asymmetry with env.ts is intentional, not a
 * bug.
 *
 * SECURITY INVARIANT: returns false whenever `nodeEnv === "production"`,
 * regardless of the flag. Next.js sets NODE_ENV="production" on every
 * Vercel build (production AND preview) and it is not runtime-controllable,
 * so this can never engage in a deployed bundle. The server independently
 * refuses MOCK under the same condition, so even a leaked flag is inert in
 * any deployed env — this is the client half of a defense-in-depth pair,
 * not the only line of defense.
 *
 * Pure and dependency-free for unit testing (scripts/mock-mode.test.mjs).
 *
 * @param publicMockFlag value of process.env.NEXT_PUBLIC_MOCK_LLM
 * @param nodeEnv        value of process.env.NODE_ENV
 */
export function isMockBypassEnabled(
  publicMockFlag: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === "production") return false;
  return publicMockFlag === "1";
}
