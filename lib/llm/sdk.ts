import { query } from "@anthropic-ai/claude-agent-sdk";
import type { LLMClient } from "./client";
import { stripCodeFences } from "../prompt";

/**
 * Default model picked via A/B testing (see scripts/ab-final.mjs).
 * Override via `LLM_MODEL` env var. Accepts short aliases ("sonnet", "haiku")
 * or full IDs ("claude-sonnet-4-5", "claude-haiku-4-5").
 */
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-4-5";

/**
 * SDK adapter: production path, uses ANTHROPIC_API_KEY via the Agent SDK.
 *
 * The Agent SDK streams structured message events from a query generator.
 * We iterate until we find a "result"-typed message and return its text.
 * Unlike the CLI adapter, we don't have a --json-schema equivalent exposed
 * cleanly, so we rely on the system prompt + parsing + fence stripping and
 * let the caller retry on schema validation failure.
 */
export class SDKAdapter implements LLMClient {
  async completeStructured(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
  }): Promise<unknown> {
    const model = input.model ?? DEFAULT_MODEL;

    // The SDK's query() signature varies across versions; we use a minimal
    // invocation and avoid strict typing on options.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = {
      systemPrompt: input.system,
      allowedTools: [],
      model,
    };

    const stream = query({
      prompt: input.user,
      options: opts,
    });

    let resultText = "";
    for await (const message of stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = message as any;
      if (msg.type === "result" && typeof msg.result === "string") {
        resultText = msg.result;
      }
    }

    if (!resultText) {
      throw new Error("Agent SDK returned no result message");
    }

    // Strip any code fences and parse. Caller will zod-validate and retry.
    const cleaned = stripCodeFences(resultText);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error(
        `SDK response was not valid JSON: ${(err as Error).message}. First 300 chars: ${cleaned.slice(0, 300)}`,
      );
    }
  }
}
