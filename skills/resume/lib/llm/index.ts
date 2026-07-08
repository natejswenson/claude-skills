import type { LLMClient } from "./client";
import { CLIAdapter } from "./cli";
import { AnthropicAdapter } from "./anthropic";

export type { LLMClient };

let cached: LLMClient | null = null;

/**
 * Factory: returns the right adapter based on LLM_MODE.
 *
 * - Default (no LLM_MODE set): the CLI adapter — free on the user's `claude`
 *   subscription. This is the skill's whole point, so it is the default even
 *   when ANTHROPIC_API_KEY happens to be set in the environment (otherwise we
 *   would silently bill the user's API key instead of using their subscription).
 * - LLM_MODE=cli: same, explicit.
 * - LLM_MODE=api: direct Anthropic Messages API (prompt caching, Haiku
 *   default). Requires ANTHROPIC_API_KEY. Used by the eval's optional L3 judge.
 *
 * Startup assertion runs once at first call, then caches the adapter.
 */
export function getLLMClient(): LLMClient {
  if (cached) return cached;

  const mode = process.env.LLM_MODE ?? "cli";

  if (mode === "api") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("LLM_MODE=api requires ANTHROPIC_API_KEY");
    }
    cached = new AnthropicAdapter();
    console.log("[llm] using Anthropic API adapter (direct, prompt caching)");
    return cached;
  }

  if (mode === "cli") {
    cached = new CLIAdapter();
    const authMode = process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? "CLAUDE_CODE_OAUTH_TOKEN"
      : "ambient CLI session";
    console.log(`[llm] using CLI adapter (${authMode})`);
    return cached;
  }

  throw new Error(`Unknown LLM_MODE: ${mode} (expected 'api' or 'cli')`);
}
