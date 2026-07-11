/**
 * Capped LLM-judge pass for the eval harness — truthfulness/optimization-rate
 * scoring via the paid Anthropic API, gated by BudgetGate. This is the
 * harness's ONLY capped judge signal (see scripts/scorer/judge-cli.mjs for
 * the separate, always-$0, non-authoritative corroborating judge — never a
 * substitute for this one). New code following the retired scorer/judge.mjs's
 * idiom: pre-call assertBudget, a real fetch to api.anthropic.com, then
 * budgetGate.record from the response's usage.
 */
import { estimateCallCost, estimateCostFromUsage, approxTokens } from "../scorer/budget.mjs";

const JUDGE_MODEL = "claude-sonnet-4-6";

const JUDGE_SYSTEM_PROMPT = `You are grading a tailored résumé against its source résumé and a target job description. Score two dimensions on a 0-100 scale:

1. tailoringFit: does the tailored output genuinely reframe bullets toward the job's requirements (not just keyword-stuff, not left generic)?
2. groundedness: is every claim in the tailored output traceable to the source résumé (no invented facts, metrics, or scope)?

Respond with ONLY a JSON object: {"tailoringFit": <0-100>, "groundedness": <0-100>, "ungroundedClaims": [<short strings, empty if none>]}`;

/**
 * @param {{ sourceResume: string, jobText: string, tailoredResume: object, budgetGate: import("../scorer/budget.mjs").BudgetGate }} input
 * @returns {Promise<{ tailoringFit: number, groundedness: number, ungroundedClaims: string[] } | { incomplete: true, reason: string }>}
 */
export async function judgeTailoringQuality({ sourceResume, jobText, tailoredResume, budgetGate }) {
  const userMessage = `SOURCE RÉSUMÉ:\n${sourceResume}\n\nJOB POSTING:\n${jobText}\n\nTAILORED OUTPUT:\n${JSON.stringify(tailoredResume, null, 2)}`;

  // The ENTIRE body below (pre-call budget check through the fetch and final
  // JSON parse) is wrapped in one try/catch. This function must never throw —
  // any failure (budget, network/DNS/offline, non-OK response, unparseable
  // JSON) resolves to an { incomplete } result so a transient fault in this
  // capped, optional judge pass can never crash the harness or block its
  // PASS/FAIL verdict (see docs/plans/2026-07-08-resume-eval-harness-design.md).
  try {
    const sysTokens = approxTokens(JUDGE_SYSTEM_PROMPT);
    const userTokens = approxTokens(userMessage);
    const estimatedUsd = estimateCallCost({
      model: JUDGE_MODEL,
      sysTokens,
      userTokens,
      outputTokensEst: 300,
      firstCall: true,
    });

    budgetGate.assertBudget(estimatedUsd);

    if (!process.env.ANTHROPIC_API_KEY) {
      return { incomplete: true, reason: "ANTHROPIC_API_KEY not set" };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 500,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      return { incomplete: true, reason: `API error ${response.status}: ${await response.text()}` };
    }

    const data = await response.json();
    const actualUsd = estimateCostFromUsage(data.usage, JUDGE_MODEL);
    budgetGate.record(actualUsd, { kind: "judge" });

    const text = (data.content ?? []).map((b) => b.text ?? "").join("");
    try {
      const parsed = JSON.parse(text.trim());
      return {
        tailoringFit: parsed.tailoringFit,
        groundedness: parsed.groundedness,
        ungroundedClaims: parsed.ungroundedClaims ?? [],
      };
    } catch {
      return { incomplete: true, reason: `unparseable judge response: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { incomplete: true, reason: `judge call failed: ${err?.message ?? String(err)}` };
  }
}
