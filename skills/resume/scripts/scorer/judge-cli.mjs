/**
 * judge-cli — $0 subscription-CLI LLM judges for the benchmark.
 *
 * NET-NEW code. Does NOT reuse scorer/judge.mjs's signature (no apiKey, no
 * budgetGate) and does NOT reuse lib/llm/cli.ts's CLIAdapter. Each judge spawns
 * its OWN `claude -p` child with `--json-schema` so it can enforce a 90s timeout
 * that KILLS the child (SIGTERM → SIGKILL) on expiry — CLIAdapter exposes no
 * cancellation hook and hard-codes a 600s ceiling, so an AbortController wrapping
 * a CLIAdapter call could not interrupt the spawned child.
 *
 * BOTH judges are NON-DETERMINISTIC (claude -p has no temperature pin) and
 * therefore SOFT / corroborating only — never a hard gate, never a non-zero exit.
 * BOTH are FAIL-OPEN: on any spawn failure, non-zero exit, the 90s kill, or an
 * unparseable/empty result, the judge returns a NEUTRAL/BLANK value with a
 * `judge_failed` reason and the caller continues. There is NO retry (keeps the
 * suite's wall-clock bounded).
 */

import { spawn } from "node:child_process";
import os from "node:os";

// Binary is overridable so fail-open can be exercised offline in tests
// (e.g. BENCHMARK_CLAUDE_BIN=false → child exits 1; a bogus name → spawn error).
// Read at spawn time (not module-load) so a single import sees env changes.
const claudeBin = () => process.env.BENCHMARK_CLAUDE_BIN ?? "claude";
const JUDGE_MODEL = process.env.BENCHMARK_JUDGE_MODEL ?? "haiku";
const JUDGE_TIMEOUT_MS = Number(process.env.BENCHMARK_JUDGE_TIMEOUT_MS ?? 90_000);
const SIGKILL_GRACE_MS = 5_000;

/**
 * Spawn a bounded `claude -p` child that emits a single schema-validated JSON
 * object. Resolves with the parsed `structured_output`; rejects on any failure
 * or on the 90s timeout (after killing the child). Callers MUST fail-open.
 *
 * @param {{ system: string, user: string, schema: object, model?: string, timeoutMs?: number }} input
 * @returns {Promise<object>}
 */
function spawnClaudeStructured({ system, user, schema, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--tools", "",
      "--output-format", "json",
      "--model", model ?? JUDGE_MODEL,
      "--system-prompt", system,
      "--json-schema", JSON.stringify(schema),
    ];

    let child;
    try {
      child = spawn(claudeBin(), args, {
        shell: false,
        cwd: os.tmpdir(), // ignore ambient project config / CLAUDE.md
        // Disable extended thinking — the latency lever (see lib/llm/cli.ts).
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(new Error(`claude spawn failed: ${err.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    // 90s hard timeout: kill the child (SIGTERM, then SIGKILL) and reject.
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }, SIGKILL_GRACE_MS).unref();
      finish(reject, new Error(`judge timed out after ${timeoutMs ?? JUDGE_TIMEOUT_MS}ms (child killed)`));
    }, timeoutMs ?? JUDGE_TIMEOUT_MS);

    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });

    child.on("error", (err) =>
      finish(reject, new Error(`claude spawn error: ${err.message}. Is 'claude' on PATH?`)));

    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(reject, new Error(`claude exited ${code}. stderr: ${stderr.slice(-300)}`));
        return;
      }
      // --output-format json emits one JSON envelope. The schema-validated
      // object is in `structured_output`; `result` carries any narrative prose.
      let env;
      try {
        env = JSON.parse(stdout.trim());
      } catch {
        finish(reject, new Error(`unparseable judge envelope: ${stdout.slice(0, 200)}`));
        return;
      }
      if (env.is_error) {
        finish(reject, new Error(`claude returned is_error: ${env.result ?? "unknown"}`));
        return;
      }
      if (env.structured_output !== undefined) {
        finish(resolve, env.structured_output);
        return;
      }
      // Fallback: schema not surfaced as structured_output — parse `result`.
      if (typeof env.result === "string") {
        const unfenced = env.result.trim()
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?```$/, "");
        try {
          finish(resolve, JSON.parse(unfenced));
          return;
        } catch {
          finish(reject, new Error(`judge result not parseable JSON: ${unfenced.slice(0, 200)}`));
          return;
        }
      }
      finish(reject, new Error(`judge envelope had no structured_output/result. keys: ${Object.keys(env).join(",")}`));
    });

    // Swallow EPIPE if the child exited before reading stdin (e.g. a test stub).
    child.stdin.on("error", () => {});
    try { child.stdin.end(user); } catch { /* child already gone */ }
  });
}

// ---------------------------------------------------------------------------
// G1 — tailoring-fit judge
// ---------------------------------------------------------------------------

const G1_SYSTEM =
  "You are a strict resume-vs-job-posting evaluator. Extract the 5-8 most " +
  "important requirements from the job posting, then judge how well the resume " +
  "bullets address each. Return ONLY the schema-validated JSON, no prose.";

const G1_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirement: { type: "string" },
          status: { type: "string", enum: ["well", "weakly", "unaddressed"] },
        },
        required: ["requirement", "status"],
      },
    },
  },
  required: ["requirements"],
};

function g1User(resume, jobText) {
  const bullets = (resume?.experience ?? []).flatMap((e) => e?.bullets ?? []);
  return [
    "JOB POSTING:",
    (jobText ?? "").slice(0, 3000),
    "",
    "RESUME BULLETS:",
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
    "",
    'For each of the 5-8 most important job requirements, set status to:',
    '  "well" — a bullet directly demonstrates it with specifics',
    '  "weakly" — a bullet tangentially relates',
    '  "unaddressed" — no bullet addresses it',
  ].join("\n");
}

function scoreFromRequirements(reqs) {
  if (!Array.isArray(reqs) || reqs.length === 0) return 50;
  const well = reqs.filter((r) => r.status === "well").length;
  const weak = reqs.filter((r) => r.status === "weakly").length;
  return Math.round((well * 100 + weak * 50) / reqs.length);
}

/**
 * G1 tailoring-fit. SOFT / corroborating only. Fail-open → neutral 50.
 * `samples` (K>1) runs the judge K times and averages the score to reduce
 * run-to-run variance. Distinct from the CLI's --repeat latency flag.
 *
 * @param {{ resume: object, jobText: string, model?: string, samples?: number }} args
 * @returns {Promise<{ score: number, breakdown: object, runs?: number }>}
 */
export async function judgeTailoringFitCli({ resume, jobText, model, samples }) {
  const k = Math.max(1, Number(samples ?? 1));
  const scores = [];
  let lastBreakdown = null;
  let failures = 0;

  for (let i = 0; i < k; i++) {
    try {
      const out = await spawnClaudeStructured({
        system: G1_SYSTEM,
        user: g1User(resume, jobText),
        schema: G1_SCHEMA,
        model,
      });
      scores.push(scoreFromRequirements(out.requirements));
      lastBreakdown = out;
    } catch (err) {
      failures++;
      lastBreakdown = { reason: "judge_failed", error: String(err).slice(0, 200) };
    }
  }

  if (scores.length === 0) {
    // Every sample failed → fail-open neutral.
    return { score: 50, breakdown: { reason: "judge_failed", ...(lastBreakdown ?? {}) }, runs: k };
  }
  const score = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  return {
    score,
    breakdown: { requirements: lastBreakdown?.requirements ?? null, samples: scores, failures },
    runs: k,
  };
}

// ---------------------------------------------------------------------------
// Grounding — no-fabrication judge (SOFT/advisory only)
// ---------------------------------------------------------------------------

const GROUNDING_SYSTEM =
  "You are a strict fact-grounding checker. Given a SOURCE resume text and a " +
  "tailored resume's summary + rewritten bullets, list any claim that asserts a " +
  "fact (employer, metric/number, job title, technology, or duration) NOT " +
  "supported by the SOURCE. Paraphrase is fine; only flag claims whose factual " +
  "content is absent from the source. Return ONLY the schema-validated JSON.";

const GROUNDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ungrounded: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          source: { type: "string", enum: ["summary", "bullet"] },
          reason: { type: "string" },
        },
        required: ["claim", "source", "reason"],
      },
    },
  },
  required: ["ungrounded"],
};

function groundingUser(resume, sourceText) {
  const bullets = (resume?.experience ?? []).flatMap((e) => e?.bullets ?? []);
  return [
    "SOURCE RESUME TEXT (authoritative — the only facts the candidate has):",
    (sourceText ?? "").slice(0, 12000),
    "",
    "TAILORED SUMMARY:",
    resume?.summary ?? "",
    "",
    "TAILORED BULLETS:",
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
    "",
    "List every claim above whose factual content is NOT supported by the SOURCE.",
  ].join("\n");
}

/**
 * Grounding (no-fabrication) judge. SOFT/advisory — a non-empty `ungrounded`
 * list is SURFACED for human review, NEVER a hard fail or non-zero exit. `ok` is
 * informational (true iff the list is empty); no caller gates on it. Fail-open →
 * empty list.
 *
 * @param {{ resume: object, sourceText: string, model?: string }} args
 * @returns {Promise<{ ok: boolean, ungrounded: object[], reason?: string }>}
 */
export async function judgeGroundingCli({ resume, sourceText, model }) {
  try {
    const out = await spawnClaudeStructured({
      system: GROUNDING_SYSTEM,
      user: groundingUser(resume, sourceText),
      schema: GROUNDING_SCHEMA,
      model,
    });
    const ungrounded = Array.isArray(out.ungrounded) ? out.ungrounded : [];
    return { ok: ungrounded.length === 0, ungrounded };
  } catch (err) {
    // Fail-open: empty list, run continues.
    return { ok: true, ungrounded: [], reason: "judge_failed", error: String(err).slice(0, 200) };
  }
}
