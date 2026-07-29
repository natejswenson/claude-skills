#!/usr/bin/env node
/**
 * Unit tests for the stored source résumé (scripts/profile.mjs).
 *
 * Run: node scripts/profile.test.mjs
 *
 * $HOME is redirected to a temp directory BEFORE importing profile.mjs, since
 * PROFILE_PATH is computed from os.homedir() at module load. Without that these
 * tests would read, overwrite and delete the developer's real résumé.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), "resume-profile-test");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const FAKE_HOME = join(TMP, "home");
mkdirSync(FAKE_HOME, { recursive: true });
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;

const {
  PROFILE_PATH,
  BACKUP_PATH,
  MIN_CHARS,
  rejectReason,
  isStored,
  readProfile,
  profileStatus,
  saveProfile,
  clearProfile,
} = await import("./profile.mjs");

let pass = 0,
  fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.stack ?? err.message}`);
    fail++;
  }
}

const GOOD = `Nate Example
Senior DevOps Engineer

EXPERIENCE
Senior DevOps Engineer, ExampleCo, Nov 2022 to Present
- Built CI/CD pipelines on GitHub Actions and Terraform across the org.
- Led AWS infrastructure for two product launches and cut MTTR by 3x.

EDUCATION
BSc Industrial Engineering, Example University, 2010
`;

function reset() {
  rmSync(PROFILE_PATH, { force: true });
  rmSync(BACKUP_PATH, { force: true });
}

console.log("\n[isolation]");
test("the test writes under the fake home, not the real one", () => {
  assert.ok(PROFILE_PATH.startsWith(FAKE_HOME), `PROFILE_PATH escaped the sandbox: ${PROFILE_PATH}`);
});

console.log("\n[rejectReason — what must never be stored]");
test("good résumé text is accepted", () => {
  assert.equal(rejectReason(GOOD), null);
});
test("raw PDF bytes are rejected by signature", () => {
  // The disaster case: storing binary makes validate.mjs's source-truth checks
  // fail spuriously on every future run, forever.
  const reason = rejectReason("%PDF-1.7\n%âãÏÓ\n" + "x".repeat(500));
  assert.ok(reason, "raw PDF was accepted");
  assert.match(reason, /raw PDF/);
});
test("a raw .docx (zip) is rejected by signature", () => {
  const reason = rejectReason("PK\u0003\u0004" + "x".repeat(500));
  assert.ok(reason, "raw docx was accepted");
  assert.match(reason, /docx|zip/);
});
test("NUL bytes are rejected", () => {
  assert.match(rejectReason(GOOD + "\u0000"), /NUL/);
});
test("mostly-control-character content is rejected", () => {
  assert.match(rejectReason("a".repeat(400) + "\u0001".repeat(50)), /binary/);
});
test("a too-short extraction is rejected", () => {
  // A failed PDF extract usually returns a few characters, not an error.
  const reason = rejectReason("Nate Swenson\nDevOps");
  assert.ok(reason);
  assert.match(reason, new RegExp(String(MIN_CHARS)));
});
test("empty and non-string content are rejected", () => {
  assert.match(rejectReason("   \n "), /empty/);
  assert.match(rejectReason(null), /not text/);
});
test("tabs and newlines are not treated as binary", () => {
  assert.equal(rejectReason(GOOD.replace(/ /g, "\t")), null);
});

console.log("\n[save / read / status]");
reset();
test("nothing is stored initially", () => {
  assert.equal(isStored(), false);
  assert.equal(readProfile(), null);
  assert.equal(profileStatus().stored, false);
});

test("saving stores the text and status reports it", () => {
  const res = saveProfile(GOOD);
  assert.equal(res.replaced, false);
  assert.equal(res.backup, null);
  assert.ok(existsSync(PROFILE_PATH));
  assert.equal(readProfile(), GOOD);

  const st = profileStatus();
  assert.equal(st.stored, true);
  assert.equal(st.chars, GOOD.length);
  assert.ok(st.updated);
});

test("a second save refuses without force", () => {
  // The stored résumé may be the only copy the user has.
  assert.throws(() => saveProfile(GOOD + "\nmore experience here."), /already stored/);
  assert.equal(readProfile(), GOOD, "the stored résumé was modified despite the refusal");
});

test("force replaces it and keeps the previous version as a backup", () => {
  const next = GOOD + "\nNEW ROLE at NewCo, 2026.\n";
  const res = saveProfile(next, { force: true });
  assert.equal(res.replaced, true);
  assert.equal(res.backup, BACKUP_PATH);
  assert.equal(readProfile(), next);
  assert.equal(readFileSync(BACKUP_PATH, "utf8"), GOOD, "backup does not hold the previous version");
});

test("a rejected save never touches an existing résumé", () => {
  const before = readProfile();
  assert.throws(() => saveProfile("%PDF-1.7 " + "x".repeat(400), { force: true }), /raw PDF/);
  assert.equal(readProfile(), before, "a rejected save overwrote the stored résumé");
});

test("a trailing newline is added exactly once", () => {
  reset();
  saveProfile(GOOD.trimEnd());
  assert.ok(readProfile().endsWith("\n"));
  assert.ok(!readProfile().endsWith("\n\n"));
});

console.log("\n[clear]");
test("clearing removes the résumé but leaves the backup", () => {
  reset();
  saveProfile(GOOD);
  saveProfile(GOOD + "\nsecond version.\n", { force: true });
  const res = clearProfile();
  assert.equal(res.removed, true);
  assert.equal(res.backup, BACKUP_PATH);
  assert.equal(isStored(), false);
  assert.ok(existsSync(BACKUP_PATH), "the backup was deleted too");
});

test("clearing when nothing is stored is a no-op", () => {
  reset();
  assert.equal(clearProfile().removed, false);
});

console.log("\n[round trip through a file]");
test("text read from a file stores and reads back identically", () => {
  reset();
  const src = join(TMP, "source.txt");
  writeFileSync(src, GOOD, "utf8");
  saveProfile(readFileSync(src, "utf8"));
  assert.equal(readProfile(), GOOD);
});

rmSync(TMP, { recursive: true, force: true });
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
