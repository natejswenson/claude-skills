/** A read-only terminal client. No controller or native host actions run here. */
import { emitKeypressEvents } from 'node:readline';
import { cleanText, monitorSnapshot } from './monitor.mjs';

const panels = ['runs', 'agents', 'details'];
const text = (value) => (cleanText(value) ?? 'unavailable').replace(/\t/g, '  ');
const line = (value) => text(value).replace(/\n/g, ' ');
const identity = (run) => run ? `${run.repository ?? run.directory} #${run.issue ?? '?'} [${run.host ?? 'unknown'}]` : 'No run selected';
const observed = (value) => `${value.lastObservedAt ?? 'unavailable'} (${value.freshness ?? 'unavailable'})`;

export function navigationDetails(host) {
  const limitation = 'External attachment unavailable. This action opens recorded details only.';
  if (host === 'codex') return `${limitation}\nIn the owning Codex CLI session use /agent, or the supported client background-agent panel. Match the recorded worker identity; this terminal cannot confirm native focus.`;
  if (host === 'claude') return `${limitation}\nIn the owning Claude Code session use /tasks, select the agent and press Enter. Completed entries have limited retention; recorded details remain available here.`;
  return `${limitation}\nHost navigation unavailable: no supported host identity was recorded.`;
}

export function createView(snapshot) {
  const view = { snapshot: null, runKey: null, agentKey: null, focus: 'runs', detailKind: 'run', scroll: 0, navigation: false };
  refreshView(view, snapshot);
  return view;
}
export function refreshView(view, snapshot) {
  view.snapshot = snapshot;
  // Never substitute another row after removal. Only an explicit selection moves it.
  if (view.runKey === null && snapshot.runs.length) chooseRun(view, snapshot.runs[0]);
  const run = snapshot.runs.find((r) => r.key === view.runKey);
  if (view.agentKey === null && run?.agents.length) view.agentKey = run.agents[0].key;
}
function chooseRun(view, run) {
  view.runKey = run.key;
  view.agentKey = run.agents[0]?.key ?? null;
  view.scroll = 0;
  view.navigation = false;
  view.detailKind = 'run';
}
function selected(view) {
  const run = view.snapshot.runs.find((r) => r.key === view.runKey);
  return { run, agent: run?.agents.find((a) => a.key === view.agentKey) };
}

export function handleKey(view, key, pageSize = 10) {
  const { name, ctrl, shift } = key;
  if (name === 'q' || ctrl && ['c', 'd'].includes(name)) return 'exit';
  if (name === 'r') return 'refresh';
  if (name === 'escape') {
    Object.assign(view, { focus: 'runs', detailKind: 'run', scroll: 0, navigation: false });
  } else if (['tab', 'left', 'right'].includes(name)) {
    const delta = name === 'left' || name === 'tab' && shift ? -1 : 1;
    view.focus = panels[(panels.indexOf(view.focus) + delta + 3) % 3];
    view.scroll = 0;
    view.navigation = false;
    if (view.focus !== 'details') view.detailKind = view.focus === 'agents' ? 'agent' : 'run';
  } else if (name === 'return' || name === 'o') {
    if (view.focus !== 'details') view.detailKind = view.focus === 'agents' ? 'agent' : 'run';
    view.focus = 'details'; view.scroll = 0; view.navigation = name === 'o';
  } else if (['up', 'down', 'j', 'k', 'pageup', 'pagedown'].includes(name)) {
    const direction = ['up', 'k', 'pageup'].includes(name) ? -1 : 1;
    if (view.focus === 'details') view.scroll = Math.max(0, view.scroll + direction * (name.startsWith('page') ? pageSize : 1));
    else {
      const { run } = selected(view), rows = view.focus === 'runs' ? view.snapshot.runs : run?.agents ?? [];
      const index = rows.findIndex((r) => r.key === (view.focus === 'runs' ? view.runKey : view.agentKey));
      const next = rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + direction))];
      if (next && view.focus === 'runs') chooseRun(view, next);
      else if (next) { view.agentKey = next.key; view.scroll = 0; view.detailKind = 'agent'; }
    }
  }
  return 'render';
}

function detailLines(view, run, agent) {
  if (!run) return [view.runKey ? 'Selected run removed or unavailable. Select another run with Up/Down.' : 'No runs discovered.', ...view.snapshot.problems];
  const lines = view.navigation ? [navigationDetails(run.host), ''] : [];
  lines.push(identity(run), `Run: ${run.key}`, `Directory: ${run.directory}`,
    `Owner fingerprint (not native session ID): ${run.ownerFingerprint ?? 'unavailable'}`,
    `Stage: ${run.currentStage ?? 'unavailable'} | State: ${run.state}`,
    `Last observed: ${observed(run)}`, `Next: ${run.nextAction ?? 'unavailable'}`, ...run.problems);
  if (view.detailKind === 'agent') {
    if (!agent) return [...lines, view.agentKey ? 'Selected agent removed or unavailable. Select another agent with Up/Down.' : run.agentsNote ?? 'No agents yet.'];
    lines.push(`Agent: ${agent.workerId ?? 'unavailable'}`, `Attempt: ${agent.attemptId}`, `Generation: ${agent.generation}`,
      `Task: ${agent.role}`, `Membership: ${agent.membership} | State: ${agent.state}`,
      `Last observed: ${observed(agent)}`, agent.reason ?? '');
    for (const detail of agent.details) lines.push(`Output: ${detail.path ?? 'unavailable'} (${detail.source ?? 'unavailable'})`,
      `Observed: ${detail.observedAt ?? 'unavailable'} (${detail.freshness})${detail.truncated ? ' [bounded excerpt]' : ''}`,
      detail.text ?? detail.reason ?? 'Output unavailable');
  } else {
    for (const stage of run.stages ?? []) lines.push(`Stage ${stage.key}: ${stage.state}`);
    for (const activity of run.stageActivity ?? []) lines.push(`${activity.source}: ${activity.stage}`,
      `Observed: ${activity.observedAt ?? 'unavailable'} (${activity.freshness})${activity.truncated ? ' [bounded excerpt]' : ''}`, activity.text ?? activity.reason ?? 'Activity unavailable');
  }
  return lines;
}

// ASCII framing, no brand tokens. Escape wide/non-ASCII characters so terminal
// cell counts stay exact, including arbitrary output and combining characters.
const cells = (value) => line(value).replace(/[^\x20-\x7e]/gu, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
const fit = (value, width) => cells(value).slice(0, width).padEnd(width);
function wrap(values, width) {
  return values.flatMap((value) => text(value).split('\n').flatMap((part) => {
    const s = cells(part), result = [];
    for (let i = 0; i < Math.max(1, s.length); i += width) result.push(s.slice(i, i + width));
    return result;
  }));
}
function listWindow(rows, key, height, empty) {
  const index = rows.findIndex((r) => r.key === key);
  const lines = rows.map((r) => r.label.split('\n').map((part, i) => `${r.key === key && i === 0 ? '> ' : '  '}${part}`));
  const position = lines.slice(0, Math.max(0, index)).reduce((total, row) => total + row.length, 0);
  const start = Math.max(0, position - Math.floor(height / 3));
  const result = lines.flat().slice(start, start + height);
  if (key && index < 0) result.unshift('> Selected row removed/unavailable');
  return result.length ? result.slice(0, height) : [empty];
}
export function renderView(view, columns = 100, rows = 24) {
  const width = Math.max(1, columns - 1), height = Math.max(1, rows - 8);
  const { run, agent } = selected(view);
  const wide = width >= 110 && rows >= 12;
  const widths = wide ? [Math.floor(width * .28), Math.floor(width * .28), width - Math.floor(width * .28) * 2 - 6] : [width, width, width];
  const details = wrap(detailLines(view, run, agent), widths[2]);
  view.scroll = Math.min(view.scroll, Math.max(0, details.length - height));
  const bodies = [
    listWindow(view.snapshot.runs.map((r) => ({ key: r.key, label: `${identity(r)}\n${r.state} | ${r.currentStage ?? 'unavailable'}\nrun ${r.key.slice(0, 12)} owner ${r.ownerFingerprint?.slice(0, 12) ?? 'unavailable'}\n${observed(r)}` })), view.runKey, height, 'No runs discovered.'),
    listWindow((run?.agents ?? []).map((a) => ({ key: a.key, label: `${a.attemptId} / ${a.workerId ?? 'unavailable'}\n${a.state} ${a.membership} | ${a.role}\n${observed(a)}` })), view.agentKey, height, run?.agentsNote ?? 'No agents available.'),
    details.slice(view.scroll, view.scroll + height),
  ];
  const heading = (i) => `${view.focus === panels[i] ? '*' : ' '} ${panels[i].toUpperCase()}${i === 2 ? ` ${view.scroll + 1}/${details.length}` : ''}`;
  if (rows < 12) return [
    `${heading(panels.indexOf(view.focus))} ${run ? identity(run) : 'run unavailable'}`,
    `Agent: ${agent?.attemptId ?? (view.agentKey ? 'removed' : 'none')}`,
    ...Array.from({ length: Math.max(0, rows - 5) }, (_, i) => bodies[panels.indexOf(view.focus)][i] ?? ''),
    'Tab panels j/k move Enter details', 'o navigate Esc overview r refresh', 'q/Ctrl-C exit PgUp/PgDn scroll',
  ].slice(0, Math.max(1, rows)).map((s) => fit(s, width)).join('\r\n');
  const output = ['ISSUEFLOW MONITOR | read-only | refreshed ' + view.snapshot.observedAt,
    `Selected run: ${run ? identity(run) : view.runKey ? 'removed/unavailable' : 'none'}`,
    `Selected agent: ${agent ? `${agent.attemptId} / ${agent.workerId ?? 'unavailable'}` : view.agentKey ? 'removed/unavailable' : 'none'} | Focus: ${view.focus}`];
  output.push(wide ? widths.map((w, i) => fit(heading(i), w)).join(' | ') : heading(panels.indexOf(view.focus)));
  for (let row = 0; row < height; row++) output.push(wide ? widths.map((w, i) => fit(bodies[i][row] ?? '', w)).join(' | ') : bodies[panels.indexOf(view.focus)][row] ?? '');
  output.push(view.snapshot.problems.join(' | ') || 'Fresh = observation age <=60s; not proof a worker is live.',
    'Tab/S-Tab/Left/Right panels | Up/Down/j/k select or scroll',
    'Enter details | PgUp/PgDn scroll | o navigation | Esc overview',
    'r refresh | q/Ctrl-C/Ctrl-D exit; runs continue');
  return output.slice(0, Math.max(1, rows)).map((s) => fit(s, width)).join('\r\n');
}

export async function runMonitor(options, { input = process.stdin, output = process.stdout, signals = process,
  env = process.env, snapshot = monitorSnapshot, intervalMs = 1000 } = {}) {
  if (!input.isTTY || !output.isTTY || !env.TERM || ['dumb', 'unknown'].includes(env.TERM)) {
    throw new Error('Interactive monitor requires input/output TTYs and an ANSI-capable TERM. Use issueflow monitor --json [--run-root <path> | --run-dir <path>].');
  }
  const view = createView(snapshot(options));
  const wasRaw = Boolean(input.isRaw), wasFlowing = input.readableFlowing === true;
  const before = new Map(['data', 'newListener'].map((event) => [event, input.rawListeners(event)]));
  const beforeSymbols = new Set(Object.getOwnPropertySymbols(input));
  return new Promise((resolve, reject) => {
    let timer, closed = false;
    const finish = (error) => {
      if (closed) return;
      closed = true; clearInterval(timer);
      input.removeListener('keypress', keypress); input.removeListener('end', end); input.removeListener('close', end);
      input.removeListener('error', fail); output.removeListener('error', fail); output.removeListener('resize', redraw);
      for (const [event, listeners] of before) for (const listener of input.rawListeners(event)) {
        if (!listeners.includes(listener)) input.removeListener(event, listener);
      }
      // readline caches its keypress decoder on the stream. Remove only the
      // symbols installed by this invocation so a reused stream can be wired
      // up again by emitKeypressEvents on the next invocation.
      for (const symbol of Object.getOwnPropertySymbols(input)) {
        if (!beforeSymbols.has(symbol) && ['keypress-decoder', 'escape-decoder'].includes(symbol.description)) delete input[symbol];
      }
      signals.removeListener('SIGINT', end); signals.removeListener('SIGTERM', end);
      let failure = error;
      try { input.setRawMode(wasRaw); if (!wasFlowing) input.pause(); } catch (e) { failure ??= e; }
      try { output.write('\x1b[?25h\x1b[?1049l'); } catch (e) { failure ??= e; }
      if (failure) reject(failure); else resolve();
    };
    const fail = (error) => finish(error), end = () => finish();
    const draw = () => output.write('\x1b[H\x1b[2J' + renderView(view, output.columns, output.rows));
    const refresh = () => { try { refreshView(view, snapshot(options)); draw(); } catch (e) { finish(e); } };
    const redraw = () => { try { draw(); } catch (e) { finish(e); } };
    const keypress = (_s, key = {}) => {
      try {
        const action = handleKey(view, key, Math.max(1, (output.rows ?? 24) - 8));
        if (action === 'exit') finish(); else if (action === 'refresh') refresh(); else draw();
      } catch (e) { finish(e); }
    };
    try {
      emitKeypressEvents(input);
      input.on('keypress', keypress).on('end', end).on('close', end).on('error', fail);
      output.on('resize', redraw).on('error', fail);
      signals.on('SIGINT', end).on('SIGTERM', end);
      input.setRawMode(true); input.resume(); output.write('\x1b[?1049h\x1b[?25l'); draw();
      timer = setInterval(refresh, intervalMs);
    } catch (e) { finish(e); }
  });
}
