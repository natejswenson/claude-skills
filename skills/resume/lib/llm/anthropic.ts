import type { LLMClient } from "./client.ts";
import { logError, logInfo } from "../log.ts";
import { reserve as reserveDailyBudget } from "./budget.ts";

/**
 * Model short-name → full ID mapping.
 */
const MODEL_MAP: Record<string, string> = {
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-4-5-20251001",
};

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "haiku";

/**
 * Per-request cost limit in USD. Enforced PRE-CALL via token estimation
 * so the cap is protective, not retroactive.
 *
 * Was $0.15 when the cap fired post-response (i.e. after the money was
 * already spent — see commit bd4540d, #3 finding A4). Now $0.15 is an
 * actual ceiling: if the pre-call estimate exceeds this, we refuse to
 * call the API.
 */
const MAX_COST_USD = 0.15;

/**
 * Output-token ceiling. Live traffic runs ~3000 tokens for a dense-resume
 * ResumeJSON (measured: 3002 tokens for a 5-role resume post-#31). 8000
 * gives a 2.5× margin for longer resumes without changing cost on normal
 * traffic (Anthropic bills actual output, not the cap). Worst-case cost
 * impact: ~$0.032 (8K × $4/M Haiku output), well under the $0.15 cap.
 */
const MAX_OUTPUT_TOKENS = 8000;

const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-20250514":  { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

/**
 * Approximate token count for a given string. Real tokenizers run ≈3–4
 * chars/token for prose; 3.5 is a middle-of-the-road safety estimate that
 * SLIGHTLY overcounts (conservative — we'd rather reject a borderline
 * request than accept one that turns out to be too expensive).
 */
const CHARS_PER_TOKEN = 3.5;

export function estimateInputTokens(systemText: string, userText: string): number {
  return Math.ceil((systemText.length + userText.length) / CHARS_PER_TOKEN);
}

/**
 * Pre-flight cost ceiling. Worst case assumes:
 *   - All input tokens are billed as cache-WRITE on first call (most
 *     expensive input tier — \$3.75/M for Sonnet).
 *   - Output hits max_tokens exactly.
 *   - No cache reads (cold cache).
 *
 * This overstates cost vs. warm-cache reality, which is deliberate: the
 * cap is a SAFETY limit, not an average-case projection. Refund via
 * warm-cache actuals happens in the post-call log line.
 */
export function estimateWorstCaseCost(
  model: string,
  inputTokens: number,
  maxOutputTokens: number,
): number {
  const rates = PRICING[model];
  if (!rates) return Infinity; // unknown model → refuse
  return (
    (inputTokens / 1_000_000) * rates.cacheWrite +
    (maxOutputTokens / 1_000_000) * rates.output
  );
}

function estimateCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): number {
  const rates = PRICING[model] ?? PRICING["claude-sonnet-4-6-20250627"];
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // Non-cached input = total input - cache_read - cache_write
  const regularInput = Math.max(0, usage.input_tokens - cacheRead - cacheWrite);
  return (
    (regularInput / 1_000_000) * rates.input +
    (usage.output_tokens / 1_000_000) * rates.output +
    (cacheRead / 1_000_000) * rates.cacheRead +
    (cacheWrite / 1_000_000) * rates.cacheWrite
  );
}

/**
 * Direct Anthropic Messages API adapter.
 *
 * Bypasses both the CLI subprocess and the Agent SDK to make a raw HTTP
 * call to api.anthropic.com. This eliminates:
 *   - CLI subprocess startup (10-20s)
 *   - Agent SDK streaming overhead
 *
 * Uses prompt caching on the system prompt (same for every request) to
 * reduce cache-creation latency on repeated calls.
 */
export class AnthropicAdapter implements LLMClient {
  private apiKey: string;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AnthropicAdapter requires ANTHROPIC_API_KEY");
    this.apiKey = key;
  }

  async completeStructured(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
  }): Promise<unknown> {
    const modelShort = input.model ?? DEFAULT_MODEL;
    const model = MODEL_MAP[modelShort] ?? modelShort;
    const t0 = Date.now();

    // Assemble the user-content string ahead of time so we can token-
    // count it BEFORE we spend money on an API call.
    const userContent = `${input.user}\n\nRespond with ONLY a valid JSON object matching this schema — no markdown, no code fences, no commentary:\n${JSON.stringify(input.schema)}`;

    // Pre-flight cost gate. Worst-case estimate (all input as cache-write,
    // full max_tokens output) is compared against MAX_COST_USD. Throws
    // BEFORE the fetch so budget is never spent on an over-cap request.
    // Replaces the prior post-call check which fired AFTER the money was
    // already gone (see #6 / threat-model finding A4).
    const inputTokens = estimateInputTokens(input.system, userContent);
    const worstCaseCost = estimateWorstCaseCost(
      model,
      inputTokens,
      MAX_OUTPUT_TOKENS,
    );
    if (worstCaseCost > MAX_COST_USD) {
      const err = new Error(
        `cost_cap_exceeded: pre-flight estimate $${worstCaseCost.toFixed(4)} (~${inputTokens} input tokens + ${MAX_OUTPUT_TOKENS} output) exceeds limit of $${MAX_COST_USD.toFixed(2)}. Reduce input size or switch to a cheaper model.`,
      );
      // Emit BEFORE throwing so the structured record lands even if the
      // caller swallows the exception. Alert rule: event=llm_cost_cap_hit
      // firing is always operator-actionable — either the prompt grew
      // unexpectedly or an attacker is probing for OOM cost.
      logError("llm_cost_cap_hit", err, {
        model,
        input_tokens_estimated: inputTokens,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        worst_case_usd: Number(worstCaseCost.toFixed(4)),
        cap_usd: MAX_COST_USD,
      });
      throw err;
    }

    // Daily rolling cap (#9). Per-call gate above guards one blast
    // radius; this guards the day's. reserveDailyBudget adds this
    // worst-case to the UTC-day counter; ok=false rejects BEFORE fetch
    // so no API-side spend occurs. Counter resets at UTC midnight.
    const budget = reserveDailyBudget(worstCaseCost);
    if (!budget.ok) {
      const err = new Error(
        `budget_exceeded: daily worst-case total would be $${(budget.totalUsd + worstCaseCost).toFixed(4)} (cap $${budget.capUsd?.toFixed(2)}). Retry after ${budget.retryAfterSeconds}s (UTC midnight rollover).`,
      );
      // Attach retry hint as a property so callers can surface it to
      // clients without string-parsing the message.
      (err as Error & { retryAfterSeconds?: number }).retryAfterSeconds =
        budget.retryAfterSeconds;
      throw err;
    }

    // Extended thinking DISABLED (#31). `budget_tokens` is a soft target per
    // Anthropic's docs, not a hard cap — the model can think past it until
    // it hits `max_tokens` (the hard cap). On dense-resume tailoring
    // prompts, thinking consistently ballooned to fill max_tokens, leaving
    // zero tokens for the text block. The response came back with only a
    // thinking block and our code threw "no text content" → HTTP 500.
    // Local repro + proven fix:
    //   with thinking → output_tokens=8000, content=[thinking], text: none
    //   without thinking → output_tokens=3002, content=[text], valid JSON
    // This is a structured-JSON extraction task; the rule-based prompt
    // provides the reasoning scaffolding. Score regression (if any) is
    // caught by scripts/scorer/*; re-baseline post-deploy.
    const body = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 1,
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Anthropic API error ${res.status}: ${errBody.slice(0, 300)}`,
      );
    }

    const data = await res.json();
    const elapsed = Date.now() - t0;

    // Log actual usage for observability. Pre-flight already gated spend;
    // this just records what actually happened vs. the estimate.
    const usage = data.usage;
    if (usage) {
      const cost = estimateCost(model, usage);
      // Emitted as structured `event=llm_call_completed` so dashboards
      // can aggregate per-model/per-day spend without regex-parsing the
      // prose line. #9 (daily spend cap) will consume this stream.
      logInfo("llm_call_completed", {
        model,
        elapsed_ms: elapsed,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens ?? 0,
        cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
        cost_usd: Number(cost.toFixed(4)),
        worst_case_usd: Number(worstCaseCost.toFixed(4)),
      });
    }

    // Extract text from response (skip thinking blocks)
    const textBlock = data.content?.find(
      (b: { type: string }) => b.type === "text",
    );
    if (!textBlock?.text) {
      // Include stop_reason, content-block types, and output-token usage so
      // the next #28-class failure is diagnosable from one log query.
      const stopReason = data.stop_reason ?? "unknown";
      const contentTypes = (data.content ?? [])
        .map((b: { type?: string }) => b.type ?? "?")
        .join(",");
      const outTokens = data.usage?.output_tokens ?? 0;
      throw new Error(
        `Anthropic API returned no text content (stop_reason=${stopReason}, content=[${contentTypes}], output_tokens=${outTokens}/${MAX_OUTPUT_TOKENS})`,
      );
    }

    // Log thinking token usage if present
    const thinkingBlock = data.content?.find(
      (b: { type: string }) => b.type === "thinking",
    );
    if (thinkingBlock) {
      console.log(`[llm] thinking used (${thinkingBlock.thinking?.length ?? 0} chars)`);
    }

    // Strip code fences if present
    let text = textBlock.text.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) text = fenceMatch[1].trim();

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Anthropic API response was not valid JSON: ${(err as Error).message}. First 300 chars: ${text.slice(0, 300)}`,
      );
    }
  }

  /**
   * Streaming variant: yields text chunks as they arrive from Anthropic,
   * then yields a terminal `{type:"final"}` event once the response is
   * fully parsed and validated as JSON.
   *
   * Same pre-flight cost + budget gates as `completeStructured()`. Same
   * caching behavior. The only difference is the wire protocol — we use
   * SSE (`stream: true`) so we can capture text deltas in real time and
   * forward them to the client for progressive UI rendering. Total
   * elapsed and cost are unchanged; the win is in time-to-first-byte.
   *
   * Consumers should treat this as a finalized success only after the
   * `final` event fires. If the stream throws or the JSON parse at the
   * end fails, the call failed even if many `text` events arrived.
   */
  async *completeStructuredStream(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
  }): AsyncGenerator<
    | { type: "text"; chunk: string }
    | {
        type: "final";
        json: unknown;
        usage: {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        cost: number;
        elapsed: number;
      }
  > {
    const modelShort = input.model ?? DEFAULT_MODEL;
    const model = MODEL_MAP[modelShort] ?? modelShort;
    const t0 = Date.now();

    const userContent = `${input.user}\n\nRespond with ONLY a valid JSON object matching this schema — no markdown, no code fences, no commentary:\n${JSON.stringify(input.schema)}`;

    // Same pre-flight gates as completeStructured(). Duplicated rather
    // than extracted to a helper to keep the fast-path obvious; if a
    // third method appears later we'll refactor.
    const inputTokens = estimateInputTokens(input.system, userContent);
    const worstCaseCost = estimateWorstCaseCost(model, inputTokens, MAX_OUTPUT_TOKENS);
    if (worstCaseCost > MAX_COST_USD) {
      const err = new Error(
        `cost_cap_exceeded: pre-flight estimate $${worstCaseCost.toFixed(4)} (~${inputTokens} input tokens + ${MAX_OUTPUT_TOKENS} output) exceeds limit of $${MAX_COST_USD.toFixed(2)}.`,
      );
      logError("llm_cost_cap_hit", err, {
        model,
        input_tokens_estimated: inputTokens,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        worst_case_usd: Number(worstCaseCost.toFixed(4)),
        cap_usd: MAX_COST_USD,
      });
      throw err;
    }

    const budget = reserveDailyBudget(worstCaseCost);
    if (!budget.ok) {
      const err = new Error(
        `budget_exceeded: daily worst-case total would be $${(budget.totalUsd + worstCaseCost).toFixed(4)} (cap $${budget.capUsd?.toFixed(2)}). Retry after ${budget.retryAfterSeconds}s (UTC midnight rollover).`,
      );
      (err as Error & { retryAfterSeconds?: number }).retryAfterSeconds =
        budget.retryAfterSeconds;
      throw err;
    }

    const body = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 1,
      stream: true,
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Anthropic API error ${res.status}: ${errBody.slice(0, 300)}`,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let accumulated = "";
    const usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    } = { input_tokens: 0, output_tokens: 0 };
    let stopReason = "unknown";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.type === "message_start" && event.message?.usage) {
          Object.assign(usage, event.message.usage);
        } else if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          const chunk = event.delta.text as string;
          accumulated += chunk;
          yield { type: "text", chunk };
        } else if (event.type === "message_delta") {
          if (event.usage?.output_tokens) usage.output_tokens = event.usage.output_tokens;
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }
      }
    }

    const elapsed = Date.now() - t0;
    const cost = estimateCost(model, usage);

    logInfo("llm_call_completed", {
      model,
      mode: "stream",
      elapsed_ms: elapsed,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: Number(cost.toFixed(4)),
      stop_reason: stopReason,
    });

    // Strip code fences + parse, same as non-streaming path
    let text = accumulated.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) text = fenceMatch[1].trim();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Anthropic streaming response was not valid JSON (stop_reason=${stopReason}): ${(err as Error).message}. First 300 chars: ${text.slice(0, 300)}`,
      );
    }

    yield { type: "final", json, usage, cost, elapsed };
  }
}
