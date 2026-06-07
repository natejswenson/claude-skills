import { spawn } from "node:child_process";
import os from "node:os";
import type { LLMClient } from "./client";

const TIMEOUT_MS = 480_000;

/**
 * Default model picked via A/B testing (see scripts/ab-final.mjs).
 * Sonnet is ~37% faster than Haiku on this task with comparable or better
 * rule compliance. Override via `LLM_MODEL` env var (e.g. `LLM_MODEL=haiku`
 * for 3x lower production cost at slightly higher variance).
 */
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "sonnet";

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
  }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const model = input.model ?? DEFAULT_MODEL;
      const args = [
        "-p",
        "--tools",
        "",
        "--output-format",
        "json",
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
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        reject(new Error(`claude CLI timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
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

        if (code !== 0) {
          reject(
            new Error(
              `claude CLI exited with code ${code}. stderr: ${stderr.slice(-500)}`,
            ),
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout);

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
            const meta = parsed.modelUsage
              ? ` [${Object.keys(parsed.modelUsage).join(",")} · ${parsed.duration_ms}ms]`
              : "";
            console.log(`[llm] CLI structured_output received${meta}`);
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
              `claude CLI JSON had neither structured_output nor a parseable result. Keys: ${Object.keys(parsed).join(",")}`,
            ),
          );
        } catch (err) {
          reject(
            new Error(
              `Failed to parse claude CLI response: ${(err as Error).message}. Raw: ${stdout.slice(0, 500)}`,
            ),
          );
        }
      });

      child.stdin.end(input.user);
    });
  }
}
