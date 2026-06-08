import { spawn } from "node:child_process";
import os from "node:os";
import type { LLMClient, ProgressFn } from "./client";

const TIMEOUT_MS = 600_000;

/**
 * Default model for the CLI (subscription) path: Haiku.
 *
 * IMPORTANT — this differs from the API path on purpose. The original A/B
 * (scripts/ab-final.mjs) found Sonnet competitive, but that ran via the API
 * adapter WITH prompt caching, where the ~9k-token system prompt is cached
 * across calls. The CLI subscription path has no such caching: every call
 * re-processes the full prompt cold, and Sonnet reliably exceeds the timeout
 * on real résumés (observed: 3/3 timeouts at 480s; Haiku completes in ~5.5m).
 * Haiku is therefore the only model that reliably finishes here.
 *
 * Override via `LLM_MODEL` env var or the `--model` flag (e.g. `sonnet` if
 * you are running through the API path where caching makes it viable).
 */
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "haiku";

/**
 * CLI adapter: shells out to `claude -p` with structured-output enforcement.
 *
 * Key design choices:
 *   - `--system-prompt` (REPLACE) instead of `--append-system-prompt`. Drops
 *     Claude Code's default system prompt (~24-39k tokens of tool/env context)
 *     which we don't need for a pure text task. Massively reduces cache
 *     creation cost and latency.
 *   - `--json-schema` enforces schema validation at the CLI level. Claude
 *     returns the validated object in `structured_output` — no JSON parsing
 *     retries needed, no code-fence stripping needed.
 *   - `--tools ""` disables all tools. Pure text-in text-out.
 *   - `--model haiku` pins to Claude Haiku 4.5. Fast, cheap, sufficient for
 *     this format-conversion task. Override via the `model` argument.
 *   - `cwd: os.tmpdir()` prevents pickup of ambient project config / CLAUDE.md.
 *   - User message written to stdin via `end()` in one shot.
 */
export class CLIAdapter implements LLMClient {
  async completeStructured(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
    onProgress?: ProgressFn;
  }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const model = input.model ?? DEFAULT_MODEL;
      // stream-json lets us observe generation incrementally (for live
      // progress) while still receiving the schema-validated object in the
      // final `result` event's `structured_output` field.
      const args = [
        "-p",
        "--tools",
        "",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        model,
        "--system-prompt",
        input.system,
        "--json-schema",
        JSON.stringify(input.schema),
      ];

      const child = spawn("claude", args, {
        shell: false,
        cwd: os.tmpdir(),
        // Disable extended thinking. This is THE latency lever for the CLI
        // path: with thinking on, the model burned ~11–15k thinking tokens
        // chewing on the (large, rule-dense) prompt before emitting a ~800-token
        // JSON — turning a ~10s call into 2+ minutes. An eval sweep over thinking
        // budgets (0 / 4000 / 8000) found 0 was BOTH the fastest (~42s/case vs
        // ~153s at 4000) AND the highest fitness (69.5 vs 66.5) — i.e. thinking
        // was making output slower *and* worse on this task. The deterministic
        // checks in lib/validate.ts cover the audits thinking used to do. Override
        // by exporting MAX_THINKING_TOKENS yourself if you want thinking back.
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      let settled = false;
      let result: Record<string, unknown> | null = null;
      let outChars = 0;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        reject(new Error(`claude CLI timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      // Parse newline-delimited JSON incrementally. Each line is one event.
      let buf = "";
      const onLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return; // ignore non-JSON noise
        }
        if (evt.type === "result") {
          result = evt;
          return;
        }
        // Surface streamed generation deltas for the progress UI.
        if (evt.type === "stream_event" && input.onProgress) {
          const inner = (evt.event ?? {}) as Record<string, unknown>;
          if (inner.type === "content_block_delta") {
            const delta = (inner.delta ?? {}) as Record<string, unknown>;
            const piece =
              (typeof delta.partial_json === "string" && delta.partial_json) ||
              (typeof delta.text === "string" && delta.text) ||
              "";
            if (piece) {
              outChars += piece.length;
              input.onProgress({ outChars });
            }
          }
        }
      };

      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          onLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `claude CLI spawn failed: ${err.message}. Is 'claude' on PATH?`,
          ),
        );
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (buf.trim()) onLine(buf); // flush any trailing partial line

        if (code !== 0) {
          reject(
            new Error(
              `claude CLI exited with code ${code}. stderr: ${stderr.slice(-500)}`,
            ),
          );
          return;
        }

        if (!result) {
          reject(
            new Error(
              `claude CLI stream ended with no result event. stderr: ${stderr.slice(-300)}`,
            ),
          );
          return;
        }

        const parsed: Record<string, unknown> = result;
        if (parsed.is_error) {
          reject(
            new Error(`claude CLI returned is_error: ${parsed.result ?? "unknown"}`),
          );
          return;
        }

        // When --json-schema is set, the validated object is in
        // `structured_output`. The `result` field contains any narrative
        // prose the model produced alongside, which we discard.
        if (parsed.structured_output !== undefined) {
          resolve(parsed.structured_output);
          return;
        }

        // Fallback: schema wasn't enforced. Try to parse `result` as JSON
        // (with code-fence strip). Should not happen in normal operation.
        if (typeof parsed.result === "string") {
          const trimmed = parsed.result.trim();
          const unfenced = trimmed.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
          try {
            resolve(JSON.parse(unfenced));
            return;
          } catch {
            reject(
              new Error(
                `claude CLI returned result but it wasn't parseable JSON: ${unfenced.slice(0, 300)}`,
              ),
            );
            return;
          }
        }

        reject(
          new Error(
            `claude CLI result event had neither structured_output nor a parseable result. Keys: ${Object.keys(parsed).join(",")}`,
          ),
        );
      });

      child.stdin.end(input.user);
    });
  }
}
