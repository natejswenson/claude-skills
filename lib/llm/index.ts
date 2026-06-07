import type { LLMClient } from "./client";
import { CLIAdapter } from "./cli";
import { SDKAdapter } from "./sdk";
import { AnthropicAdapter } from "./anthropic";

export type { LLMClient };

let cached: LLMClient | null = null;

/**
 * Factory: returns the right adapter based on LLM_MODE.
 *
 * - LLM_MODE=api: direct Anthropic Messages API (fastest — no subprocess,
 *   prompt caching, Haiku default). Requires ANTHROPIC_API_KEY.
 * - LLM_MODE=sdk: uses @anthropic-ai/claude-agent-sdk with ANTHROPIC_API_KEY.
 * - LLM_MODE=cli: shells out to `claude` CLI with subscription auth.
 * - Default (no LLM_MODE set): auto-selects api > sdk > cli based on
 *   available env vars.
 *
 * Startup assertion runs once at first call, then caches the adapter.
 */
export function getLLMClient(): LLMClient {
  if (cached) return cached;

  const explicit = process.env.LLM_MODE;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  // Resolve mode: explicit > auto-detect (api preferred for speed)
  const mode = explicit ?? (hasApiKey ? "api" : "cli");

  if (mode === "api") {
    if (!hasApiKey) {
      throw new Error("LLM_MODE=api requires ANTHROPIC_API_KEY");
    }
    cached = new AnthropicAdapter();
    console.log("[llm] using Anthropic API adapter (direct, prompt caching)");
    return cached;
  }

  if (mode === "sdk") {
    if (!hasApiKey) {
      throw new Error("LLM_MODE=sdk requires ANTHROPIC_API_KEY");
    }
    cached = new SDKAdapter();
    console.log("[llm] using SDK adapter (ANTHROPIC_API_KEY)");
    return cached;
  }

  if (mode === "cli") {
    cached = new CLIAdapter();
    const authMode = process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? "CLAUDE_CODE_OAUTH_TOKEN"
      : "ambient ~/.claude OAuth session";
    console.log(`[llm] using CLI adapter (${authMode})`);
    return cached;
  }

  throw new Error(`Unknown LLM_MODE: ${mode} (expected 'api', 'sdk', or 'cli')`);
}
