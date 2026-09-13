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
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
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
function toolFacts(name, input = {}, { codex = false, rawInput } = {}) {
  const tool = codex ? String(name).replace(/^functions[._]/, '') : name;
  const patch = typeof input === 'string' ? input : rawInput ?? input?.patch ?? input?.input;
  input = input && typeof input === 'object' ? input : {};
  const facts = {};
  const kinds = {
    command: ['Bash', 'exec_command'],
    read: ['Read', 'Grep', 'Glob', 'read_file'],
    edit: ['Write', 'Edit', 'NotebookEdit', 'apply_patch'],
    question: ['AskUserQuestion', 'request_user_input'],
    delegation: ['Agent', 'spawn_agent'],
    skill: ['Skill'],
  };
  for (const [kind, names] of Object.entries(kinds)) {
    if (names.includes(tool)) facts.toolKind = kind;
  }
  if (name === 'Bash') facts.command = clip(input.command ?? '', CAP.command);
  if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(name)) facts.path = redact(input.file_path ?? '');
  if (name === 'Skill') facts.skill = String(input.skill ?? '');
  if (name === 'Agent') facts.agent = String(input.subagent_type ?? 'general-purpose');
  if (name === 'AskUserQuestion') facts.questions = (input.questions ?? []).length;
  if (name === 'Grep' || name === 'Glob') facts.pattern = redact(String(input.pattern ?? ''));
  if (codex) {
    const command = input.cmd ?? input.command;
    if (command) facts.command = clip(command, CAP.command);
    if (tool === 'exec') facts.executionUnknown = true; // Never execute or infer the control flow of wrapped JavaScript.
    if (input.workdir || input.cwd) facts.cwd = redact(input.workdir ?? input.cwd);
    if (tool === 'exec_command' && !command && typeof rawInput === 'string') facts.command = clip(rawInput, CAP.command);
    if (facts.toolKind === 'question') facts.questions = (input.questions ?? []).length;
    if (['Read', 'read_file', 'Write', 'Edit', 'NotebookEdit'].includes(tool)) facts.path = redact(input.file_path ?? input.path ?? '');
    if (facts.toolKind === 'skill') facts.skill = redact(input.skill ?? '');
    if (facts.toolKind === 'delegation') facts.agent = redact(input.agent_type ?? input.subagent_type ?? 'general-purpose');
    if (tool === 'Grep' || tool === 'Glob') facts.pattern = redact(input.pattern ?? '');
    if (tool === 'apply_patch') {
      // Only file headers are evidence; patch bodies never enter the trace.
      facts.paths = typeof patch === 'string'
        ? [...new Set([...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)\r?$/gm)].map(m => redact(m[1])))]
        : [];
      if (facts.paths.length > 0) facts.path = facts.paths[0];
    }
  }
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
export function normalizeTranscript(jsonl, { anchors = false, source = null } = {}) {
  let metadata = {};
  const lines = jsonl.split('\n');
  const events = [];
  const dropped = { unparsed: 0, bookkeeping: 0, thinking: 0 };
  let n = 0;
  const push = (line, event) => {
    n += 1;
    events.push({ id: `e${n}`, line, ...(anchors ? { ...metadata, source } : {}), ...event });
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
    metadata = {timestamp: rec.timestamp ?? null, nativeId: rec.uuid ?? rec.payload?.id ?? null, sessionId: rec.sessionId ?? null};

    // Codex rollouts contain response items plus duplicate UI event messages.
    // Read response_item only so each message/tool call is counted once.
    if (rec.type === 'response_item') {
      const p = rec.payload ?? {};
      if (p.type === 'reasoning') {
        dropped.thinking += 1;
      } else if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
        const text = (p.content ?? []).filter(b => ['input_text', 'output_text', 'text'].includes(b.type))
          .map(b => b.text ?? '').join('\n');
        const said = stripInjected(text);
        if (said && !(p.role === 'user' && /^\s*<(environment_context|permissions instructions|collaboration_mode)>/.test(said))) {
          push(line, { kind: p.role, text: clip(said, CAP[p.role]) });
        } else dropped.bookkeeping += 1;
      } else if (['function_call', 'custom_tool_call'].includes(p.type)) {
        let input = {};
        try { input = JSON.parse(p.arguments ?? '{}'); } catch { input = p.arguments; }
        const name = String(p.name ?? '?');
        push(line, {
          kind: 'tool-use', name,
          ...(p.call_id ? { callId: p.call_id } : {}),
          ...toolFacts(name, input, { codex: true, rawInput: p.input }),
        });
      } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
        push(line, { kind: 'tool-result', text: clip(output, CAP.result), ...(anchors ? {process: processFacts(output)} : {}),
          ...(p.call_id ? { callId: p.call_id } : {}) });
      } else dropped.bookkeeping += 1;
      continue;
    }

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
            ...(anchors ? {callId:block.tool_use_id??null,process:processFacts(resultText(block))} : {}),
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
          ...(anchors ? {callId:block.id??null} : {}),
          ...toolFacts(block.name, block.input ?? {}),
          ...(rec.attributionSkill ? { attributedTo: String(rec.attributionSkill) } : {}),
        });
      }
    }
  }

  return { events, dropped };
}

export function traceFile(path, options = {}) {
  const trace = normalizeTranscript(readFileSync(path, 'utf8'), options);
  return {
    $comment:
      'A coding session, normalized. Thinking blocks, injected reminders and harness bookkeeping are dropped; secrets and home paths are masked. Event ids are positional and only stable for a frozen file.',
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


/** Parse only structured process receipts. Text in a shell/JS program is not proof it ran. */
export function processFacts(output) {
  const records=[]; let visited=0;
  const visit=(value,depth=0)=>{
    if(depth>8||++visited>2000)return;
    if(typeof value==='string') {try{visit(JSON.parse(value),depth+1)}catch{};return;}
    if(!value||typeof value!=='object')return;
    if(Number.isInteger(value.exit_code)||Number.isInteger(value.exitCode)) {
      records.push({exitCode:value.exit_code??value.exitCode,
        command:typeof value.command==='string'?redact(value.command):typeof value.cmd==='string'?redact(value.cmd):null,
        cwd:typeof value.cwd==='string'?redact(value.cwd):null,
        outputHash:createHash('sha256').update(String(value.output??'')).digest('hex'),
        outputSummary:clip(value.output??'',CAP.result)});
    }
    for(const v of Object.values(value))visit(v,depth+1);
  };
  visit(output);return records;
}

/** Explicit parent/child bundle. No filesystem crawling, transcript evaluation or time-based dedup. */
export function traceBundle(entries) {
  if(!Array.isArray(entries)||!entries.length)throw new Error('trace bundle requires explicit source entries');
  const sources=[],events=[],seen=new Map();const dropped={unparsed:0,bookkeeping:0,thinking:0,inherited:0};
  const ids=new Set(entries.map(e=>e.sessionId));
  if(ids.size!==entries.length||ids.has(undefined))throw new Error('bundle session IDs must be unique and explicit');
  for(const entry of entries) {
    if(entry.parentId&&!ids.has(entry.parentId))throw new Error('bundle parent is unavailable');
    const bytes=readFileSync(entry.path,'utf8'),sha=createHash('sha256').update(bytes).digest('hex');
    sources.push({sessionId:entry.sessionId,parentId:entry.parentId??null,file:basename(entry.path),sha256:sha});
    const trace=normalizeTranscript(bytes,{anchors:true,source:sha});
    for(const key of ['unparsed','bookkeeping','thinking'])dropped[key]+=trace.dropped[key];
    for(const event of trace.events) {
      const origin={source:sha,line:event.line,eventId:event.id,sessionId:entry.sessionId};
      const identity=event.callId?`${event.kind}:${event.callId}`:event.nativeId?`${event.kind}:${event.nativeId}`:null;
      const body=JSON.stringify({kind:event.kind,text:event.text,name:event.name,command:event.command,process:event.process});
      // Multiple result chunks sharing callId are distinct unless their bytes agree.
      const key=identity?identity+':'+createHash('sha256').update(body).digest('hex'):null;
      if(key&&seen.has(key)){seen.get(key).origins.push(origin);dropped.inherited++;continue;}
      const item={...event,sessionId:entry.sessionId,parentId:entry.parentId??null,origins:[origin]};
      events.push(item);if(key)seen.set(key,item);
    }
  }
  events.sort((a,b)=>{const x=Date.parse(a.timestamp),y=Date.parse(b.timestamp);return Number.isFinite(x)&&Number.isFinite(y)?x-y:0});
  events.forEach((e,i)=>{e.id=`e${i+1}`});
  return {schema:2,sources,events,dropped,coverage:{childSources:'explicit-only',wrappedExecution:'unknown unless structured process receipts exist'}};
}
