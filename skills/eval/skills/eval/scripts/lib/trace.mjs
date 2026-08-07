/**
 * The run — a session transcript turned into events something can cite.
 *
 * A Claude Code session on disk is an append-only JSONL of bookkeeping records:
 * permission modes, file-history snapshots, title guesses, injected reminders.
 * None of that is the run. What a grader needs is the ordered sequence of
 * things that actually happened — what the user asked, what the agent said it
 * did, and which commands it really executed — each addressable so a finding
 * can point at one.
 *
 * Three deliberate omissions:
 *
 *   - **thinking blocks are dropped.** They are not the product. Grading a run
 *     on its private reasoning punishes an agent for considering an option and
 *     rejecting it, which is exactly the behaviour worth encouraging.
 *   - **injected `<system-reminder>` payloads are stripped from user turns.**
 *     They were never typed by the user; counting them as the request makes
 *     every run look like it was asked to do things nobody asked for.
 *   - **secrets and absolute home paths are masked.** A trace becomes a
 *     committed fixture, and a fixture is forever.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const CAP = { user: 4000, assistant: 6000, result: 300, command: 2000 };

/** Shapes that must never reach a committed fixture. */
const SECRETS = [
  [/\b(sk-[A-Za-z0-9_-]{16,})/g, 'sk-REDACTED'],
  [/\b(ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, 'gh-REDACTED'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA-REDACTED'],
  [/\b([Bb]earer\s+)[A-Za-z0-9._-]{20,}/g, '$1REDACTED'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox-REDACTED'],
];

export function redact(text) {
  let out = String(text ?? '');
  const home = homedir();
  if (home && home.length > 1) out = out.split(home).join('~');
  for (const [re, sub] of SECRETS) out = out.replace(re, sub);
  return out;
}

const clip = (text, max) => {
  const t = redact(text).replace(/\r/g, '');
  return t.length <= max ? t : `${t.slice(0, max)}\n…[clipped ${t.length - max} chars]`;
};

/** Injected context is not something the user said. */
const stripInjected = (text) =>
  String(text ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[\s\S]*?<\/local-command-[a-z]+>/g, '')
    .trim();

/**
 * The fields of a tool call that matter for grading, per tool. Everything else
 * is dropped: a trace that carries whole file bodies is a liability, not
 * evidence.
 */
function toolFacts(name, input = {}) {
  const facts = {};
  if (name === 'Bash') facts.command = clip(input.command ?? '', CAP.command);
  if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(name)) facts.path = redact(input.file_path ?? '');
  if (name === 'Skill') facts.skill = String(input.skill ?? '');
  if (name === 'Agent') facts.agent = String(input.subagent_type ?? 'general-purpose');
  if (name === 'AskUserQuestion') facts.questions = (input.questions ?? []).length;
  if (name === 'Grep' || name === 'Glob') facts.pattern = redact(String(input.pattern ?? ''));
  return facts;
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
};

const resultText = (block) => {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n');
  return '';
};

/**
 * Normalize one session JSONL into `{events, dropped}`. Event ids are positional
 * (`e1`, `e2`, …) over the kept events, which is stable for a frozen file and
 * meaningless for a live one — the reason a baseline pins a snapshot.
 */
export function normalizeTranscript(jsonl) {
  const lines = jsonl.split('\n');
  const events = [];
  const dropped = { unparsed: 0, bookkeeping: 0, thinking: 0 };
  let n = 0;
  const push = (line, event) => {
    n += 1;
    events.push({ id: `e${n}`, line, ...event });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      dropped.unparsed += 1;
      continue;
    }
    const line = i + 1;

    if (rec.type !== 'user' && rec.type !== 'assistant') {
      dropped.bookkeeping += 1;
      continue;
    }
    const content = rec.message?.content;

    if (rec.type === 'user') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue;
          push(line, {
            kind: 'tool-result',
            isError: Boolean(block.is_error),
            text: clip(resultText(block), CAP.result),
          });
        }
      }
      const said = stripInjected(textOf(content));
      // `isMeta` marks harness-authored user turns; they are not the user asking.
      if (said && !rec.isMeta) push(line, { kind: 'user', text: clip(said, CAP.user) });
      continue;
    }

    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'thinking') {
        dropped.thinking += 1;
        continue;
      }
      if (block?.type === 'text' && block.text?.trim()) {
        push(line, { kind: 'assistant', text: clip(block.text, CAP.assistant) });
      }
      if (block?.type === 'tool_use') {
        push(line, {
          kind: 'tool-use',
          name: String(block.name ?? '?'),
          ...toolFacts(block.name, block.input ?? {}),
          ...(rec.attributionSkill ? { attributedTo: String(rec.attributionSkill) } : {}),
        });
      }
    }
  }

  return { events, dropped };
}

export function traceFile(path) {
  const trace = normalizeTranscript(readFileSync(path, 'utf8'));
  return {
    $comment:
      'A real Claude Code session, normalized. Thinking blocks, injected reminders and harness bookkeeping are dropped; secrets and home paths are masked. Event ids are positional and only stable for a frozen file.',
    ...trace,
  };
}

/**
 * `--grep` takes comma-separated LITERAL substrings, matched case-insensitively
 * with OR semantics — deliberately not a regular expression.
 *
 * Building a RegExp out of a command-line argument is regex injection: a
 * pathological pattern from a script, a CI job or a pasted command hangs the
 * process on a string nobody audited. Literal alternatives cover every real
 * lookup here — "the events that piped into awk or tail" — without handing an
 * untrusted string to the regex engine.
 */
export const literalMatcher = (needles) => {
  const parts = String(needles)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('--grep needs at least one substring');
  return (haystack) => {
    const hay = String(haystack).toLowerCase();
    return parts.some((p) => hay.includes(p));
  };
};

export const counts = (events) =>
  events.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
