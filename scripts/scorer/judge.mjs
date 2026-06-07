/**
 * L3 LLM judge — Haiku evaluator for G1 tailoring-fit and G4 writing-quality.
 *
 * Batched per resume. Gated behind L1+L2 — caller decides when to invoke.
 */

import { approxTokens, estimateCallCost, estimateCostFromUsage } from "./budget.mjs";

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

/**
 * G1 Tailoring-fit judge.
 *
 * Given a JD and a tailored resume, score: for each JD requirement, is it
 * addressed by the resume bullets (well | weakly | unaddressed)?
 *
 * @param {{
 *   resume: object,         // ResumeJSON
 *   jobText: string,
 *   apiKey: string,
 *   budgetGate: import('./budget.mjs').BudgetGate,
 * }} args
 * @returns {Promise<{ score: number, breakdown: object, cost: number }>}
 */
export async function judgeTailoringFit({ resume, jobText, apiKey, budgetGate }) {
  const bullets = resume.experience.flatMap((r) => r.bullets || []);
  const userMsg = [
    `JOB POSTING:`,
    jobText.slice(0, 3000),
    ``,
    `RESUME BULLETS:`,
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
    ``,
    `Task: Extract the 5-8 most important requirements from the job posting.`,
    `For each requirement, classify how well the resume addresses it:`,
    `  "well" — at least one bullet directly demonstrates this requirement with specifics`,
    `  "weakly" — a bullet tangentially relates`,
    `  "unaddressed" — no bullet addresses it`,
    ``,
    `Return ONLY JSON in this exact shape:`,
    `{`,
    `  "requirements": [`,
    `    { "requirement": "<text>", "status": "well"|"weakly"|"unaddressed", "bullet_index": <n>|null }`,
    `  ]`,
    `}`,
  ].join("\n");

  const sysTokens = approxTokens(userMsg);
  const estCost = estimateCallCost({
    model: JUDGE_MODEL,
    sysTokens: 0,
    userTokens: sysTokens,
    outputTokensEst: 600,
    firstCall: true,
  });
  budgetGate.assertBudget(estCost);

  const data = await callHaiku({ user: userMsg, apiKey });
  const actualCost = estimateCostFromUsage(data.usage, JUDGE_MODEL);
  budgetGate.record(actualCost, { kind: "judge-g1", model: JUDGE_MODEL });

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(data.text));
  } catch {
    // Judge returned invalid — default to neutral
    return { score: 50, breakdown: { error: "parse_fail", raw: data.text }, cost: actualCost };
  }

  const reqs = parsed.requirements ?? [];
  if (reqs.length === 0) return { score: 50, breakdown: parsed, cost: actualCost };
  const well = reqs.filter((r) => r.status === "well").length;
  const weak = reqs.filter((r) => r.status === "weakly").length;
  const score = Math.round(((well * 100 + weak * 50) / reqs.length));
  return { score, breakdown: parsed, cost: actualCost };
}

/**
 * G4 Writing-quality judge. Light-touch — rates 1-5 on rubric.
 */
export async function judgeWritingQuality({ resume, apiKey, budgetGate }) {
  const bullets = resume.experience.flatMap((r) => r.bullets || []).slice(0, 20);
  const userMsg = [
    `RESUME BULLETS:`,
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
    ``,
    `Rate the overall writing quality of these bullets on a 1-5 scale:`,
    `  5 = varied, specific, and human-sounding. No template cadence, no AI-speak.`,
    `  4 = mostly good with a few templated phrases.`,
    `  3 = competent but formulaic.`,
    `  2 = reads like a resume-generator template.`,
    `  1 = entirely generic AI-output.`,
    ``,
    `Return ONLY JSON: { "rating": <1-5>, "reasoning": "<one sentence>" }`,
  ].join("\n");

  const estCost = estimateCallCost({
    model: JUDGE_MODEL,
    sysTokens: 0,
    userTokens: approxTokens(userMsg),
    outputTokensEst: 150,
    firstCall: true,
  });
  budgetGate.assertBudget(estCost);

  const data = await callHaiku({ user: userMsg, apiKey });
  const actualCost = estimateCostFromUsage(data.usage, JUDGE_MODEL);
  budgetGate.record(actualCost, { kind: "judge-g4", model: JUDGE_MODEL });

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(data.text));
  } catch {
    return { score: 50, breakdown: { error: "parse_fail" }, cost: actualCost };
  }
  const rating = Math.max(1, Math.min(5, parsed.rating ?? 3));
  const score = Math.round((rating - 1) / 4 * 100); // 1→0, 5→100
  return { score, breakdown: parsed, cost: actualCost };
}

// ---------- shared ----------

async function callHaiku({ user, apiKey }) {
  const body = {
    model: JUDGE_MODEL,
    max_tokens: 1024,
    temperature: 0.2,
    messages: [{ role: "user", content: user }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Judge API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content?.find((b) => b.type === "text")?.text ?? "").trim();
  return { text, usage: data.usage };
}

function stripJsonFence(text) {
  const m = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : text).trim();
}
