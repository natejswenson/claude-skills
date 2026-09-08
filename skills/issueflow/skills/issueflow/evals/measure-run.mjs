#!/usr/bin/env node
/**
 * Measure what a real issueflow run cost, from the Claude Code session that
 * drove it: every subagent's turns, context tokens (input + cache reads +
 * cache writes), output tokens and minutes, plus the orchestrator's own.
 *
 *   node evals/measure-run.mjs <session.jsonl> [--split <iso-timestamp>]
 *
 * The session file lives under ~/.claude/projects/<project>/<session>.jsonl
 * and its subagents under <session>/subagents/. `--split` labels agents
 * dispatched before that instant as run A and after it as run B, for a
 * session that drove two runs. Reads only usage fields and each subagent's
 * first user message (to name its brief); prints nothing else from the
 * transcripts.
 *
 * This is the instrument behind 0.9.0: the two local-fitness runs it
 * measured (#241, #242) spent 83–94% of 1.1B context tokens in the review
 * loop, and the shape of rounds 2+ was changed on that number. Run it on the
 * next real run and compare. A maintainer tool — not part of a user run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const split = argv.includes('--split') ? argv[argv.indexOf('--split') + 1] : null;
if (!file || !existsSync(file)) {
  console.error('usage: measure-run.mjs <session.jsonl> [--split <iso-timestamp>]');
  process.exit(2);
}

function scan(path) {
  const out = { turns: 0, ctx: 0, cacheCreate: 0, cacheRead: 0, out: 0, first: null, last: null, tools: {}, maxCtx: 0, firstUser: '', models: {} };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.timestamp) { out.first ??= j.timestamp; out.last = j.timestamp; }
    if (j.type === 'user' && !out.firstUser) {
      const c = j.message?.content;
      out.firstUser = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? '') : '');
    }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    out.turns += 1;
    const ctx = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    out.ctx += ctx; out.cacheCreate += u.cache_creation_input_tokens ?? 0; out.cacheRead += u.cache_read_input_tokens ?? 0; out.out += u.output_tokens ?? 0;
    if (ctx > out.maxCtx) out.maxCtx = ctx;
    const m = j.message.model ?? '?';
    out.models[m] = (out.models[m] ?? 0) + 1;
    for (const c of j.message.content ?? []) if (c.type === 'tool_use') out.tools[c.name] = (out.tools[c.name] ?? 0) + 1;
  }
  return out;
}

const M = (n) => `${(n / 1e6).toFixed(2)}M`;
const K = (n) => `${Math.round(n / 1e3)}k`;
const mins = (s) => (s.first && s.last ? ((Date.parse(s.last) - Date.parse(s.first)) / 60000).toFixed(1) : '-');
const pad = (rows) => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd()).join('\n');
};

const main = scan(file);
const subDir = join(dirname(file), basename(file, '.jsonl'), 'subagents');
const subs = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => scan(join(subDir, f))) : [];
subs.sort((a, b) => String(a.first).localeCompare(String(b.first)));

const rows = [['run', 'brief', 'model', 'turns', 'mins', 'ctx', 'cacheWrite', 'out', 'maxCtx', 'killed']];
const agg = {};
for (const s of subs) {
  const run = split ? (s.first < split ? 'A' : 'B') : '-';
  const m = s.firstUser.replace(/\s+/g, ' ').match(/briefs\/([\w.-]+)\.md/);
  const brief = m ? m[1] : s.firstUser.replace(/\s+/g, ' ').slice(0, 50);
  const kind = brief.replace(/-\d+$/, '').replace(/^[\w-]+?-(review|fix)-/, '$1-').replace(/-r\d+/, '');
  const killed = Object.keys(s.models).includes('<synthetic>') ? 'yes' : '';
  rows.push([run, brief, Object.keys(s.models).filter((x) => x !== '<synthetic>').join('|'), s.turns, mins(s), M(s.ctx), M(s.cacheCreate), K(s.out), K(s.maxCtx), killed]);
  const k = `${run} ${kind}`;
  agg[k] ??= { n: 0, turns: 0, ctx: 0, out: 0, mins: 0 };
  agg[k].n += 1; agg[k].turns += s.turns; agg[k].ctx += s.ctx; agg[k].out += s.out; agg[k].mins += Number(mins(s)) || 0;
}
console.log(pad(rows));
console.log('');
console.log(pad([['run kind', 'agents', 'turns', 'ctx', 'out', 'agent-mins'], ...Object.entries(agg).map(([k, v]) => [k, v.n, v.turns, M(v.ctx), K(v.out), v.mins.toFixed(0)])]));
const T = subs.reduce((a, s) => ({ turns: a.turns + s.turns, ctx: a.ctx + s.ctx, out: a.out + s.out }), { turns: 0, ctx: 0, out: 0 });
console.log('');
console.log(`subagents: ${subs.length} agents, ${T.turns} turns, ${M(T.ctx)} context tokens, ${M(T.out)} output tokens, ${subs.filter((s) => '<synthetic>' in s.models).length} killed`);
console.log(`orchestrator: ${main.turns} turns, ${M(main.ctx)} context tokens, ${M(main.out)} output tokens, peak context ${K(main.maxCtx)}, ${main.tools.Agent ?? 0} dispatches, ${mins(main)} minutes wall-clock`);
