#!/usr/bin/env node
/**
 * Tier-1 skill-contract test ($0, offline, deterministic — runs in CI).
 *
 * The scripts enforce schema and rendering. They do not enforce the process
 * rules that keep a tailored résumé honest: never invent facts, validate
 * against the plain-text source rather than a binary path, stop after three
 * validation attempts instead of silently retrying, treat job-description text
 * as data. Those live only in SKILL.md prose, and tools/score_skill.py scores
 * structure rather than content — so a deleted rule scores 100 and ships.
 *
 * Data-driven from skill-invariants.json: adding a guardrail = adding an entry.
 *
 * Run: node scripts/skill-contract.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// CHANGELOG.md lives at the plugin root (two levels up from the skill dir) —
// plugin auto-discovery requires SKILL.md nested under skills/<name>/.
const PLUGIN_ROOT = resolve(SKILL_ROOT, "..", "..");

const MANIFEST = JSON.parse(
  readFileSync(join(SKILL_ROOT, "skill-invariants.json"), "utf8")
);
const SKILL_MD = readFileSync(join(SKILL_ROOT, "SKILL.md"), "utf8");

let pass = 0,
  fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    ${err.message}`);
    fail++;
  }
}

console.log("\nskill contract: SKILL.md guardrails\n");

await test("the manifest declares at least one guardrail", () => {
  // Anti-vacuity: an emptied `prose` array would make every check below a no-op.
  assert.ok(
    MANIFEST.prose?.length >= 5,
    `expected >= 5 prose invariants, got ${MANIFEST.prose?.length ?? 0}`
  );
});

for (const inv of MANIFEST.prose) {
  await test(`prose invariant present: ${inv.id}`, () => {
    const text = readFileSync(join(SKILL_ROOT, inv.file), "utf8");
    assert.ok(
      new RegExp(inv.pattern, "is").test(text),
      `SKILL invariant '${inv.id}' is missing from ${inv.file}.\n    ` +
        `Why it matters: ${inv.rationale}\n    ` +
        `If you intentionally reworded it, update the pattern in ` +
        `skill-invariants.json; do NOT delete the guardrail.`
    );
  });
}

await test("every script referenced by SKILL.md exists", () => {
  const refs = [...new Set([...SKILL_MD.matchAll(/scripts\/([\w.-]+\.mjs)/g)].map((m) => m[1]))];
  assert.ok(refs.length > 0, "expected SKILL.md to reference at least one script");
  const missing = refs.filter((r) => !existsSync(join(SKILL_ROOT, "scripts", r)));
  assert.equal(missing.length, 0, `SKILL.md references missing scripts: ${missing.join(", ")}`);
});

await test("every references/ doc named by SKILL.md exists", () => {
  const refs = [...new Set([...SKILL_MD.matchAll(/references\/([\w.-]+\.md)/g)].map((m) => m[1]))];
  assert.ok(refs.length > 0, "expected SKILL.md to reference at least one references/ doc");
  const missing = refs.filter((r) => !existsSync(join(SKILL_ROOT, "references", r)));
  assert.equal(
    missing.length,
    0,
    `SKILL.md points at missing references/ doc(s): ${missing.join(", ")} — the ` +
      `tailoring rules would have nowhere to send the agent.`
  );
});

await test("SKILL.md version matches the top CHANGELOG entry", () => {
  const fm = /^---\n(.*?)\n---\n/s.exec(SKILL_MD);
  assert.ok(fm, "SKILL.md has no frontmatter block");
  const v = /^version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(fm[1]);
  assert.ok(v, "SKILL.md frontmatter has no `version: x.y.z`");

  const changelog = readFileSync(join(PLUGIN_ROOT, "CHANGELOG.md"), "utf8");
  const top = /^##\s*\[(\d+\.\d+\.\d+)\]/m.exec(changelog);
  assert.ok(top, "CHANGELOG.md has no `## [x.y.z]` entry");

  assert.equal(
    v[1],
    top[1],
    `SKILL.md version ${v[1]} != top CHANGELOG entry ${top[1]}. Bump both ` +
      `together (repo release rule).`
  );
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
