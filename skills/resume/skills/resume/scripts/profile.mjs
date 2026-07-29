#!/usr/bin/env node
/**
 * profile.mjs — the stored source résumé.
 *
 * A user supplies their résumé ONCE. It is kept as plain text at
 * ~/.claude/resume/source-resume.txt and reused for every later run, so
 * tailoring only ever needs a job posting.
 *
 * Plain text, not a parsed structure, is deliberate. This file is the ground
 * truth scripts/validate.mjs checks a tailored résumé against — the thing that
 * catches an invented number or an inflated scope. Storing a parsed structure
 * instead would make the *parse* the ground truth, and a fact dropped or
 * mangled during extraction would become unfalsifiable from then on.
 *
 * Usage:
 *   node scripts/profile.mjs --status [--json-output]
 *   node scripts/profile.mjs --save <file|->  [--force]
 *   node scripts/profile.mjs --show
 *   node scripts/profile.mjs --path
 *   node scripts/profile.mjs --clear --force
 */
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "node:fs";

export const CONFIG_DIR = join(homedir(), ".claude", "resume");
export const PROFILE_PATH = join(CONFIG_DIR, "source-resume.txt");
export const BACKUP_PATH = `${PROFILE_PATH}.bak`;

/**
 * A real résumé is longer than this. The guard exists because a failed PDF or
 * DOCX extraction usually yields a handful of characters rather than an error,
 * and storing that silently poisons every future run's fact-checking.
 */
export const MIN_CHARS = 200;

/**
 * Reject anything that is not plain text.
 *
 * The specific disaster this prevents: saving raw `.pdf`/`.docx` BYTES as the
 * source. validate.mjs reads this file with a plain utf8 read, so binary
 * content becomes garbled "text" that matches nothing — every source-truth
 * check then fails on a perfectly clean tailoring, and the natural response to
 * a spurious failure is to stop trusting the validator. SKILL.md warns about
 * passing a binary path to the validator; this is the same trap one step
 * earlier, and here it would persist across every future run.
 *
 * @returns {string|null} a reason to reject, or null if the text is fine
 */
export function rejectReason(text) {
  if (typeof text !== "string") return "content is not text";

  const trimmed = text.trim();
  if (trimmed.length === 0) return "content is empty";

  if (/^%PDF-/.test(trimmed)) {
    return "this is raw PDF data, not text — extract the text first (the Read tool handles .pdf; use scripts/docx-to-text.mjs for .docx)";
  }
  if (/^PK\u0003\u0004/.test(text)) {
    return "this is a raw .docx/zip archive, not text — run scripts/docx-to-text.mjs on it first";
  }
  if (text.includes("\u0000")) {
    return "content contains NUL bytes, so it is binary rather than text";
  }

  // Control characters other than tab/newline/carriage-return indicate binary
  // that slipped past the signature checks above.
  const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  if (controls / text.length > 0.01) {
    return "content looks binary (too many control characters) rather than plain text";
  }

  if (trimmed.length < MIN_CHARS) {
    return `only ${trimmed.length} characters — a real résumé is longer, so this is probably a failed extraction (minimum ${MIN_CHARS})`;
  }
  return null;
}

/** Is a source résumé stored? */
export function isStored() {
  return existsSync(PROFILE_PATH);
}

/** Read the stored résumé text, or null if there isn't one. */
export function readProfile() {
  if (!isStored()) return null;
  return readFileSync(PROFILE_PATH, "utf8");
}

export function profileStatus() {
  if (!isStored()) return { stored: false, path: PROFILE_PATH };
  const text = readFileSync(PROFILE_PATH, "utf8");
  const st = statSync(PROFILE_PATH);
  return {
    stored: true,
    path: PROFILE_PATH,
    chars: text.length,
    updated: st.mtime.toISOString(),
    hasBackup: existsSync(BACKUP_PATH),
  };
}

/**
 * Store résumé text.
 *
 * Overwriting requires `force`, because the stored résumé may be the only copy
 * of something the user cannot easily reproduce. The previous version is kept
 * at source-resume.txt.bak for the same reason.
 */
export function saveProfile(text, { force = false } = {}) {
  const reason = rejectReason(text);
  if (reason) throw new Error(`refusing to store the résumé: ${reason}`);

  if (isStored() && !force) {
    throw new Error(
      "a source résumé is already stored — pass --force to replace it " +
        `(the current one is at ${PROFILE_PATH})`,
    );
  }

  mkdirSync(dirname(PROFILE_PATH), { recursive: true });
  const replaced = isStored();
  if (replaced) copyFileSync(PROFILE_PATH, BACKUP_PATH);
  writeFileSync(PROFILE_PATH, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return { path: PROFILE_PATH, replaced, backup: replaced ? BACKUP_PATH : null };
}

/** Delete the stored résumé. The backup, if any, is left in place. */
export function clearProfile() {
  const existed = isStored();
  rmSync(PROFILE_PATH, { force: true });
  return { removed: existed, backup: existsSync(BACKUP_PATH) ? BACKUP_PATH : null };
}

const HELP = `profile — manage the stored source résumé

The résumé is supplied once and reused for every later run, so tailoring only
needs a job posting. It is stored as plain text at:
  ${PROFILE_PATH}

Usage:
  node scripts/profile.mjs --status [--json-output]   is one stored?
  node scripts/profile.mjs --save <file|->  [--force] store a résumé (- reads stdin)
  node scripts/profile.mjs --show                     print the stored text
  node scripts/profile.mjs --path                     print the storage path
  node scripts/profile.mjs --clear --force            delete the stored résumé

Store plain TEXT, never a .pdf/.docx path — the file is the ground truth that
validate.mjs checks tailored content against, and binary content silently
breaks every future run.`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--status") flags.status = true;
    else if (a === "--save") flags.save = argv[++i];
    else if (a === "--show") flags.show = true;
    else if (a === "--path") flags.path = true;
    else if (a === "--clear") flags.clear = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--json-output") flags.jsonOutput = true;
  }
  return flags;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || Object.keys(flags).length === 0) {
    console.log(HELP);
    return;
  }

  if (flags.path) {
    console.log(PROFILE_PATH);
    return;
  }

  if (flags.status) {
    const st = profileStatus();
    if (flags.jsonOutput) {
      console.log(JSON.stringify(st, null, 2));
    } else if (st.stored) {
      console.log(`✓ source résumé stored (${st.chars} chars, updated ${st.updated})`);
      console.log(`  ${st.path}`);
    } else {
      console.log("no source résumé stored yet");
      console.log(`  it will be saved to ${st.path}`);
    }
    return;
  }

  if (flags.show) {
    const text = readProfile();
    if (text === null) {
      console.error(`✖ no source résumé stored at ${PROFILE_PATH}`);
      process.exit(1);
    }
    process.stdout.write(text);
    return;
  }

  if (flags.clear) {
    if (!flags.force) {
      console.error("✖ --clear requires --force (this deletes the stored résumé)");
      process.exit(2);
    }
    const res = clearProfile();
    console.log(res.removed ? `✓ removed ${PROFILE_PATH}` : "nothing to remove");
    if (res.backup) console.log(`  a backup remains at ${res.backup}`);
    return;
  }

  if (flags.save) {
    const text = flags.save === "-" ? readStdin() : readFileSync(resolve(flags.save), "utf8");
    let res;
    try {
      res = saveProfile(text, { force: flags.force });
    } catch (err) {
      console.error(`✖ ${err.message}`);
      process.exit(1);
    }
    if (flags.jsonOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`✓ ${res.replaced ? "replaced" : "stored"} source résumé → ${res.path}`);
      if (res.backup) console.log(`  previous version kept at ${res.backup}`);
    }
    return;
  }

  console.log(HELP);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message ?? err}`);
    process.exit(1);
  });
}
