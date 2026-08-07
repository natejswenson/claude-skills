/**
 * Claude Code session transcripts → digests.
 *
 * A transcript is a JSONL append log of every message in one session. We keep a
 * digest, never the transcript: the digest is what a report can cite, and the
 * transcript is where the secrets are.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { redact, newCounts } from './redact.mjs';

export const defaultTranscriptRoot = () => join(homedir(), '.claude', 'projects');

export function listTranscripts(root = defaultTranscriptRoot()) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const dir of readdirSync(root)) {
    const full = join(root, dir);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(full)) {
      if (f.endsWith('.jsonl')) out.push(join(full, f));
    }
  }
  return out.sort();
}

const textOf = (message) => {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n');
  return '';
};

/**
 * One transcript → one digest, or null when the file holds no timestamped
 * message (a session that was opened and never used).
 */
export function digestTranscript(file, counts = newCounts(), home = homedir()) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return null; }

  let sessionId = null;
  let cwd = null;
  let aiTitle = null;
  let firstPrompt = null;
  const branches = new Set();
  const tools = Object.create(null);
  const skills = new Set();
  const uuids = [];
  let start = null;
  let end = null;
  let userTurns = 0;
  let assistantTurns = 0;
  let edits = 0;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.sessionId && !sessionId) sessionId = d.sessionId;
    if (d.cwd) cwd = d.cwd;
    if (d.gitBranch) branches.add(d.gitBranch);
    if (d.type === 'ai-title' && d.aiTitle) aiTitle = d.aiTitle;
    if (d.attributionSkill) skills.add(d.attributionSkill);

    if (d.timestamp) {
      if (!start || d.timestamp < start) start = d.timestamp;
      if (!end || d.timestamp > end) end = d.timestamp;
    }
    if (d.uuid && (d.type === 'user' || d.type === 'assistant')) uuids.push(d.uuid);

    if (d.type === 'user' && !d.isSidechain) {
      userTurns += 1;
      if (firstPrompt === null) {
        const t = textOf(d.message).trim();
        if (t && !t.startsWith('<')) firstPrompt = t.slice(0, 400);
      }
    }
    if (d.type === 'assistant') {
      assistantTurns += 1;
      const c = d.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b && b.type === 'tool_use' && b.name) {
            tools[b.name] = (tools[b.name] ?? 0) + 1;
            if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') edits += 1;
          }
        }
      }
    }
  }

  if (!sessionId || !start) return null;

  const project = cwd ? basename(cwd) : 'unknown';
  const title = aiTitle || (firstPrompt ? firstPrompt.split('\n')[0].slice(0, 90) : `session in ${project}`);

  return {
    id: `session:${sessionId}`,
    kind: 'session',
    receipt: `session:${sessionId}`,
    sessionId,
    at: end,
    start,
    end,
    project,
    title: redact(title, counts, home),
    firstPrompt: redact(firstPrompt ?? '', counts, home),
    branches: [...branches].sort(),
    skills: [...skills].sort(),
    tools,
    uuids,
    userTurns,
    assistantTurns,
    edits,
    source: basename(file),
  };
}

export function indexSessions({ root = defaultTranscriptRoot(), since = null, counts = newCounts(), home = homedir() } = {}) {
  const digests = [];
  let scanned = 0;
  let skipped = 0;
  for (const file of listTranscripts(root)) {
    scanned += 1;
    // The watermark is cheap to honour: mtime bounds the newest message in the log.
    if (since) {
      try {
        if (statSync(file).mtime.toISOString() < since) { skipped += 1; continue; }
      } catch { /* fall through and read it */ }
    }
    const d = digestTranscript(file, counts, home);
    if (d) digests.push(d); else skipped += 1;
  }
  return { digests, scanned, skipped };
}
