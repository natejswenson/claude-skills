import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from './Markdown';
import { TextOutput, isTextOutput } from './TextOutput';
import { pickOutput, pdfCompanion } from './outputs';
import { PdfOutput } from './PdfOutput';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, FileText, Folder, History, LayoutGrid, LoaderCircle, Plus, Search, Settings, Square, Star, Terminal, X, Zap } from 'lucide-react';
import { Request } from './Request';
import { matchesRun, loadSelectedRun } from './history';
import { RunLoadState } from './RunLoadState';
import { SkillBrief } from './SkillBrief';
import { RunStatus, WorkspaceTabs, currentActivity, type WorkspaceTab } from './RunStatus';
import { AttachmentPicker, MessageAttachments, encodeAttachments, type SavedAttachment } from './Attachments';
import './tokens.css';
import './style.css';
type Skill = {
    id: string;
    name: string;
    description: string;
    category: string;
    available: boolean;
    example?: string;
};
type Message = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    attachments?: SavedAttachment[];
};
type Run = {
    id: string;
    title: string;
    skillId?: string;
    threadId?: string;
    turnId?: string | null;
    status: string;
    cwd: string;
    model: string;
    messages: Message[];
    activities: {
        id: string;
        label: string;
        turnId?: string | null;
        detail?: string;
        status: string;
    }[];
    pending: {
        id: string;
        method: string;
        params: any;
    }[];
    artifacts: {
        id: string;
        name: string;
        type: string;
        collectionId?: string;
    }[];
    error?: string;
    createdAt: string;
    updatedAt: string;
};
type Bootstrap = {
    capabilities?: { attachments?: boolean };
    account: {
        type: string;
        planType?: string;
    } | null;
    connection: {
        status: string;
        error?: string;
    };
    models: {
        id: string;
        model: string;
        displayName: string;
        isDefault: boolean;
    }[];
    skills: Skill[];
    workspace: string;
    runs: Run[];
};
const active = (r?: Run | null) => !!r && ['working', 'awaiting_input', 'approval_needed', 'collecting_output'].includes(r.status);
const labels: Record<string, string> = { collecting_output: 'Preparing outputs', working: 'Working', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted', awaiting_input: 'Your answer needed', approval_needed: 'Approval needed' };
const titleCase = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const date = (s: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(s));
async function api<T>(path: string, body?: unknown): Promise<T> { const r = await fetch(path, { ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); const data = await r.json(); if (!r.ok)
    throw new Error(data.error || `Request failed (${r.status})`); return data; }
function App() {
    const [data, setData] = useState<Bootstrap | null>(null), [view, setView] = useState('start'), [selected, setSelected] = useState<string | null>(() => location.hash.startsWith('#run/') ? decodeURIComponent(location.hash.slice(5)) : null), [run, setRun] = useState<Run | null>(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [prompt, setPrompt] = useState(''), [skillId, setSkillId] = useState(''), [model, setModel] = useState(''), [query, setQuery] = useState(''), [category, setCategory] = useState('All skills'), [favoriteOnly, setFavoriteOnly] = useState(false), [favorites, setFavorites] = useState<string[]>(() => { try {
        return JSON.parse(localStorage.getItem('studio:favorites') || '[]');
    }
    catch {
        return [];
    } }), [palette, setPalette] = useState(false), [workspace, setWorkspace] = useState(''), [artifactId, setArtifactId] = useState(''), [inspector, setInspector] = useState<'output' | 'activity'>('output'), [eventsConnected, setEventsConnected] = useState(true), [split, setSplit] = useState(50), [runQuery,setRunQuery]=useState(''),[reply,setReply]=useState('');
    const [runLoadError,setRunLoadError]=useState(''),[runLoadAttempt,setRunLoadAttempt]=useState(0);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('conversation'), [atLatest, setAtLatest] = useState(true);
    const outputRef = useRef<HTMLElement>(null), replyRef = useRef<HTMLTextAreaElement>(null);
    const [newFiles, setNewFiles] = useState<File[]>([]), [replyFiles, setReplyFiles] = useState<File[]>([]), [reattachHint, setReattachHint] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null), composerRef = useRef<HTMLTextAreaElement>(null), endRef = useRef<HTMLDivElement>(null), selectedRef = useRef(selected), followOutput=useRef(true), paletteRef=useRef<HTMLElement>(null);
    selectedRef.current = selected;
    const refresh = useCallback(async () => { try {
        const next = await api<Bootstrap>('/api/bootstrap');
        setData(next);
        setWorkspace(v => v || next.workspace);
        setModel(v => (next.models.some(m=>m.id===v)?v:'') || next.models.find(m => m.isDefault)?.id || next.models[0]?.id || '');
        if (selectedRef.current) {
            const id=selectedRef.current;
            try {
                const nextRun=await api<Run>(`/api/runs/${id}`);
                if(selectedRef.current===id){setRun(nextRun);setRunLoadError('');}
            } catch(error) {
                if(selectedRef.current===id)setRunLoadError((error as Error).message);
            }
        }
    }
    catch (e) {
        setError((e as Error).message);
    } }, []);
    useEffect(() => { void refresh(); let timer: ReturnType<typeof setTimeout>|undefined; const stream = new EventSource('/api/events'); stream.onopen = () => setEventsConnected(true); stream.onerror = () => setEventsConnected(false); stream.onmessage = () => { if(timer)return; timer=setTimeout(()=>{timer=undefined;void refresh()},100); }; return () => { clearTimeout(timer); stream.close(); }; }, [refresh]);
    useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPalette(p => !p);
    } if (e.key === 'Escape')
        setPalette(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
    useEffect(()=>{if(!palette)return;const previous=document.activeElement as HTMLElement;searchRef.current?.focus();const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const controls=Array.from(paletteRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]')||[]);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}};document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus()}},[palette]);
    useEffect(() => { localStorage.setItem('studio:favorites', JSON.stringify(favorites)); }, [favorites]);
    useEffect(() => {
        setReplyFiles([]); setWorkspaceTab('conversation'); setAtLatest(true);
        setRun(null);setRunLoadError('');
        if (selected) {
            setView('workspace');
            followOutput.current=true;setReply('');
            location.hash = `run/${encodeURIComponent(selected)}`;
            return loadSelectedRun(()=>api<Run>(`/api/runs/${selected}`), {
                onLoad:next=>{if(selectedRef.current===selected){setRun(next);setRunLoadError('');}},
                onError:message=>{if(selectedRef.current===selected)setRunLoadError(message);},
            });
        }
        history.replaceState(null, '', location.pathname + location.search);
    }, [selected,runLoadAttempt]);
    useEffect(() => { const fn = () => setSelected(location.hash.startsWith('#run/') ? decodeURIComponent(location.hash.slice(5)) : null); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
    useEffect(() => { if(followOutput.current)endRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }, [run?.messages.length, run?.messages.at(-1)?.text.length]);
    const pendingKey = run ? `${run.id}:${run.pending.map(p => p.id).join(',')}` : '';
    useEffect(() => { if (run?.pending.length) { setWorkspaceTab('conversation'); followOutput.current = true; setAtLatest(true); setTimeout(() => endRef.current?.scrollIntoView({ block: 'nearest' }), 0); } }, [pendingKey]);
    const artifactRevisionKey=run?`${run.id}:${run.artifacts.map(a=>a.id).join(',')}`:'';
    useEffect(() => { setArtifactId(current => pickOutput(run?.artifacts || [], current) || ''); }, [artifactRevisionKey]);
    const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    const navigate = (next: string) => { setView(next); if (next !== 'workspace')
        setSelected(null); setPalette(false); };
    const focusComposer = () => setTimeout(() => { composerRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); composerRef.current?.focus({ preventScroll: true }); }, 0);
    const choose = (s: Skill) => { setReattachHint(false); setSkillId(s.id); navigate('start'); focusComposer(); };
    const showOutput = () => { setWorkspaceTab('output'); setInspector('output'); setTimeout(() => outputRef.current?.focus({ preventScroll: true }), 0); };
    const showConversation = () => { setWorkspaceTab('conversation'); setTimeout(() => replyRef.current?.focus(), 0); };
    const jumpToLatest = () => { followOutput.current = true; setAtLatest(true); endRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); };
    const launch = () => void act(async () => { const attachments = data?.capabilities?.attachments ? await encodeAttachments(newFiles) : []; const created = await api<Run>('/api/runs', { prompt: prompt.trim(), ...(attachments.length ? { attachments } : {}), ...(skillId ? { skillId } : {}), ...(model ? { model } : {}), workspace: data?.workspace }); setPrompt(''); setNewFiles([]); setReattachHint(false); setRun(created); setSelected(created.id); await refresh(); });
    const send = () => void act(async () => { const id = run!.id, text = reply.trim(); const attachments = data?.capabilities?.attachments ? await encodeAttachments(replyFiles) : []; const next = await api<Run>(`/api/runs/${id}/messages`, { prompt: text, ...(attachments.length ? { attachments } : {}) }); if (selectedRef.current === id) { setRun(next); setReply(''); setReplyFiles([]); followOutput.current=true; } await refresh(); });
    const respond = (requestId: string, result: unknown) => void act(async () => { setRun(await api<Run>(`/api/runs/${run!.id}/respond`, { requestId, result })); await refresh(); });
    const ready = data?.account?.type === 'chatgpt' && data.connection.status === 'connected';
    const currentSkill = data?.skills.find(s => s.id === skillId);
    const running = data?.runs.find(r => active(r));
    const matchingRuns=(data?.runs||[]).filter(r=>matchesRun(r,runQuery));
    const allSkills = data?.skills || [];
    const filtered = allSkills.filter(s => (!query || `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())) && (category === 'All skills' || s.category === category) && (!favoriteOnly || favorites.includes(s.id)));
    const categories = ['All skills', ...Array.from(new Set(allSkills.map(s => s.category))).sort()];
    const openFile = (name: string) => { const file = run?.artifacts.filter(a => a.name === name).at(-1); if (file) { setArtifactId(file.id); showOutput(); } };
    const outputCount = new Set(run?.artifacts.map(a => a.name)).size;
    const selectedArtifact = run?.artifacts.find(a => a.id === artifactId);
    const companionId = run && selectedArtifact ? pdfCompanion(run.artifacts, selectedArtifact.id) : undefined;
    const companionUrl = run && companionId ? `/api/runs/${run.id}/artifacts/${companionId}` : undefined;
    const artifactUrl = run && selectedArtifact ? `/api/runs/${run.id}/artifacts/${encodeURIComponent(selectedArtifact.id)}` : '';
    return <div className="app-shell">
  <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('start'); }} aria-label="Skills Studio home"><span className="brand-mark">s<span>.</span></span><span>Skills<br />Studio</span></a><div className="sidebar-section mono">Your local workspace</div><nav aria-label="Main navigation">{[{ id: 'start', text: 'Skill library', Icon: LayoutGrid }, { id: 'runs', text: 'Your runs', Icon: History }, { id: 'settings', text: 'Settings', Icon: Settings }].map(({ id, text, Icon }) => <button key={id} className={`nav-item ${view === id ? 'selected' : ''}`} aria-label={text} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={17}/><span>{text}</span>{id === 'runs' && data && <span className="nav-count">{data.runs.length}</span>}</button>)}</nav><button className="search-shortcut" onClick={() => setPalette(true)}><Search size={15}/><span>Find a skill</span><kbd>⌘ K</kbd></button><div className="recent-nav"><div className="sidebar-section mono">Recent work</div>{data?.runs.slice(0, 5).map(r => <button key={r.id} className={`recent-item ${selected === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r.id); setView('workspace'); }}><span className={`status-dot ${r.status === 'working' ? 'working' : ''}`}/><span>{r.title}</span></button>)}{data && !data.runs.length && <p className="sidebar-note">Your first idea<br />starts here.</p>}</div><div className="sidebar-bottom"><span className="mono connection-label"><span className={`status-dot ${ready ? 'connected' : ''}`}/>{ready ? 'Codex connected' : data ? 'Codex setup needed' : 'Connecting…'}</span><div className="subscription">{data?.account?.planType ? `${titleCase(data.account.planType)} subscription` : 'Your subscription. Your machine.'}</div><button className="workspace-link" onClick={() => navigate('settings')} title={data?.workspace}><Folder size={14}/><span>{data?.workspace.split('/').filter(Boolean).at(-1) || 'Choose workspace'}</span><ArrowUpRight size={13}/></button></div></aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>Studio</span><span>/</span><strong>{view === 'workspace' ? 'Workspace' : view === 'runs' ? 'Your runs' : view === 'settings' ? 'Settings' : 'Skill library'}</strong></div><div className="topbar-right"><span className="mono local-label">LOCAL · PRIVATE · YOURS</span><span className="stamp">NS</span></div></header>
  {error && <div className="notice" role="alert"><span><strong>Something needs attention.</strong> {error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}
  {!eventsConnected && <div className="notice" role="status">Live updates disconnected. Reconnecting automatically… <button onClick={() => void refresh()}>Refresh now</button></div>}
  {!data ? <main className="loading-page"><LoaderCircle className="spin"/><h1>Opening your studio.</h1><p>Connecting to your local Codex session.</p><button onClick={() => void refresh()}>Try again</button></main> : view === 'start' ? <main className="library-page">
   <section className="hero"><div className="eyebrow">A little direction. Extraordinary work.</div><h1>What will you<br />make today<span className="hero-period">?</span></h1><p className="standfirst">Your skills, ready to work. Bring an idea. Leave with something real.</p></section>
   <section className="launch-area" aria-label="Start a run"><div className="composer-top"><span className="mono">YOUR BRIEF</span><span className="composer-helper">{currentSkill ? 'Tell this skill what you have in mind' : 'Start freely, or choose a skill below'}</span></div>{currentSkill && <SkillBrief skill={currentSkill} onRemove={() => setSkillId('')} busy={busy || !!running} onExample={() => { setPrompt(text => text.trim() ? `${text}\n\n${currentSkill.example}` : currentSkill.example || ''); focusComposer(); }}/>}<textarea ref={composerRef} aria-label="Describe your task" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && prompt.trim() && ready && !busy && !running && currentSkill?.available !== false) {
            e.preventDefault();
            launch();
        } }} placeholder={currentSkill?.example || 'Describe what you want to create…'} rows={3}/>{reattachHint && <p className="reattach-note" role="status">Reattach files to include them in this new run.</p>}{data.capabilities?.attachments && <AttachmentPicker files={newFiles} onChange={setNewFiles} disabled={busy || !!running}/>}<div className="composer-footer"><div className="model-picker"><Zap size={15}/><select aria-label="Codex model" value={model} onChange={e => setModel(e.target.value)}>{data.models.length ? data.models.map(m => <option key={m.id} value={m.id}>{m.displayName || m.model}</option>) : <option value="">Codex · default model</option>}</select><ChevronDown size={12}/></div><button className="primary" disabled={!ready || !prompt.trim() || busy || !!running || currentSkill?.available === false} onClick={launch}>{busy ? <><LoaderCircle size={17} className="spin"/>Starting…</> : <>Start creating<ArrowUpRight size={17}/></>}</button></div>{running && <p className="setup-prompt">One run is already in progress. <button onClick={() => setSelected(running.id)}>Return to your run <ArrowRight size={13}/></button></p>}{!ready && <p className="setup-prompt">Connect your Codex subscription to start. <button onClick={() => navigate('settings')}>Open settings <ArrowRight size={13}/></button></p>}</section>
   <section className="catalog"><div className="section-heading"><div><h2>The skill library<span className="count">{allSkills.length}</span></h2><p className="caption">Specialized know-how. One good starting point.</p></div><button className={`favorite-filter ${favoriteOnly ? 'is-on' : ''}`} aria-pressed={favoriteOnly} onClick={() => setFavoriteOnly(v => !v)}><Star size={15} fill={favoriteOnly ? 'currentColor' : 'none'}/>Favorites</button></div><div className="catalog-tools"><div className="category-list" aria-label="Filter by category">{categories.map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{titleCase(c)}</button>)}</div><label className="library-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills"/>{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14}/></button>}</label></div><p className="catalog-note">Skills include their instructions. Connected services and tools depend on your Codex setup.</p><div className="skill-grid">{filtered.map((s, i) => <article className="skill-card" key={s.id}><div className="skill-top"><span className="mono skill-number">{String(i + 1).padStart(2, '0')} / {titleCase(s.category)}</span><button className="star-button" aria-label={`${favorites.includes(s.id) ? 'Remove' : 'Add'} ${s.name} ${favorites.includes(s.id) ? 'from' : 'to'} favorites`} aria-pressed={favorites.includes(s.id)} onClick={() => setFavorites(f => f.includes(s.id) ? f.filter(v => v !== s.id) : [...f, s.id])}><Star size={16} fill={favorites.includes(s.id) ? 'currentColor' : 'none'}/></button></div><button className="skill-main" onClick={() => choose(s)}><h3>{s.name}<ArrowUpRight size={21}/></h3><p>{s.description}</p></button><div className="skill-bottom mono"><span>{s.available ? 'Instructions available' : 'Setup required'}</span><button onClick={() => choose(s)}>{s.available ? 'Open skill' : 'View skill'}<ArrowRight size={14}/></button></div></article>)}</div>{!filtered.length && <div className="empty-state"><Search size={28}/><h3>No skills found.</h3><p>Try another search or clear your filters.</p><button onClick={() => { setQuery(''); setCategory('All skills'); setFavoriteOnly(false); }}>Clear filters <ArrowRight size={15}/></button></div>}</section><footer className="colophon"><span>Built for the way you work.</span><span>Powered by your Codex subscription ↗</span></footer>
  </main> : view === 'runs' ? <main className="standard-page"><div className="page-heading"><div className="eyebrow">Your work, kept close</div><h1>Good ideas.<br />Real outcomes.</h1><p className="standfirst">Pick up where you left off, or start something new.</p></div><div className="section-heading"><h2>Your runs<span className="count">{data.runs.length}</span></h2><button className="text-button" onClick={() => navigate('start')}><Plus size={16}/>New run</button></div>{data.runs.length ? <><label className="history-search library-search"><Search size={16}/><input value={runQuery} onChange={e=>setRunQuery(e.target.value)} placeholder="Search your runs" aria-label="Search your runs"/></label><div className="run-list">{matchingRuns.map(r => <div className="history-row" key={r.id}><button className="run-row" onClick={() => setSelected(r.id)}><FileText size={21}/><div><strong>{r.title}</strong><span>{r.skillId ? data.skills.find(s => s.id === r.skillId)?.name || r.skillId : 'Open task'} · {date(r.createdAt)}</span></div><span className="mono run-status">{labels[r.status] || r.status}</span><ArrowUpRight size={19}/></button><button className="run-again text-button" onClick={()=>{setNewFiles([]);setReattachHint(r.messages.some(m => !!m.attachments?.length));setSkillId(r.skillId||'');setPrompt(r.messages.find(m=>m.role==='user')?.text||r.title);setModel(r.model);navigate('start');setTimeout(()=>composerRef.current?.focus(),0)}}>Run again<ArrowRight size={13}/></button></div>)}</div>{!matchingRuns.length&&<div className="empty-state"><Search size={25}/><h3>No matching runs.</h3><button onClick={()=>setRunQuery('')}>Clear search</button></div>}</> : <div className="empty-state roomy"><History size={32}/><h2>A clean slate.</h2><p>Your runs and finished work will appear here.</p><button className="primary" onClick={() => navigate('start')}>Explore the library<ArrowRight size={16}/></button></div>}</main> : view === 'settings' ? <main className="standard-page settings-page"><div className="page-heading"><div className="eyebrow">Make yourself at home</div><h1>Your studio.<br />Your setup.</h1><p className="standfirst">Connected to your subscription. Running on your machine.</p></div><section className="setting-section"><div><span className="mono">01 / CONNECTION</span><h2>Codex subscription</h2><p>Skills Studio uses your installed Codex and its native ChatGPT sign-in.</p></div><div className="setting-content"><div className="connection-detail"><Zap size={22}/><div><strong>{ready ? 'Connected to Codex' : 'Connection needs attention'}</strong><p>{ready ? `${titleCase(data.account?.planType || 'ChatGPT')} subscription · native Codex authentication` : data.connection.error || 'Sign in with your ChatGPT account to start using skills.'}</p></div>{ready && <Check size={20}/>}</div>{!ready && <><p>Run this in your terminal, choose ChatGPT sign-in, then refresh the connection.</p><div className="command-line"><Terminal size={17}/><code>codex login</code><button onClick={() => void navigator.clipboard.writeText('codex login').catch(() => setError('Could not copy. Run codex login in your terminal.'))}>Copy</button></div></>}<button className="text-button" disabled={busy} onClick={() => void act(async()=>{await api('/api/reconnect',{});await refresh()})}>Refresh connection<ArrowRight size={15}/></button><p className="fine-print">Subscription usage limits apply. API-key sessions cannot start a run in Skills Studio.</p></div></section><section className="setting-section"><div><span className="mono">02 / WORKSPACE</span><h2>A place for your work</h2><p>Codex runs inside this folder. Choose a trusted folder for your projects and generated files.</p></div><form className="setting-content" onSubmit={e => { e.preventDefault(); void act(async () => { const next = await api<{
            workspace: string;
        }>('/api/workspace', { path: workspace }); setWorkspace(next.workspace); await refresh(); }); }}><label className="mono" htmlFor="workspace-path">ABSOLUTE FOLDER PATH</label><input id="workspace-path" className="path-input" value={workspace} onChange={e => setWorkspace(e.target.value)} required placeholder="/Users/you/projects"/><button className="text-button" disabled={busy || !workspace.trim() || workspace === data.workspace}>Save workspace<ArrowRight size={15}/></button><p className="fine-print">Workspace changes apply to new runs. Existing runs keep their original folder.</p></form></section><section className="setting-section"><div><span className="mono">03 / SKILLS</span><h2>Your existing library</h2><p>Skills stay in their original folders. Their instructions remain the source of truth.</p></div><div className="setting-content"><strong>{allSkills.length} skills discovered</strong><p>{allSkills.filter(s => s.available).length} instructions available · {allSkills.filter(s => !s.available).length} require setup</p><button className="text-button" onClick={() => navigate('start')}>Browse the library<ArrowRight size={15}/></button></div></section></main> : <main className="workspace-page">{run && run.id === selected ? <><div className="workspace-heading"><div><div className="eyebrow">{run.skillId ? data.skills.find(s => s.id === run.skillId)?.name || run.skillId : 'Open task'} / {labels[run.status] || run.status}</div><h1>{run.title.length === 80 ? `${run.title.replace(/\s+\S*$/, '')}…` : run.title}</h1></div><button className="text-button" onClick={() => navigate('start')}><Plus size={16}/>New run</button></div><div className="workspace-meta mono"><span title={run.cwd}><Folder size={13}/>{run.cwd.split('/').filter(Boolean).at(-1)}</span><span>{run.model || 'Codex'}</span><span>{date(run.createdAt)}</span></div><WorkspaceTabs tab={workspaceTab} onChange={tab => { setWorkspaceTab(tab); if (tab !== 'conversation') setInspector(tab); }} outputCount={outputCount} activityCount={run.activities.length} attention={run.pending.length > 0}/><div className={`workspace-split workspace-view-${workspaceTab}`} style={{ '--split': `${split}%` } as React.CSSProperties}><section className="conversation" aria-label="Conversation"><div className="conversation-scroll" onScroll={e=>{const el=e.currentTarget;followOutput.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;setAtLatest(followOutput.current)}}>{run.messages.map(m => <article key={m.id} className={`message ${m.role}`}><div className="message-label mono">{m.role === 'user' ? 'YOU' : 'CODEX'}</div><div className="markdown"><Markdown files={run.artifacts.map(a => a.name)} workspace={run.cwd} onOpenFile={openFile}>{m.text}</Markdown></div>{m.attachments && <MessageAttachments runId={run.id} attachments={m.attachments}/>}</article>)}{run.error && <p className="run-error" role="alert">{run.error}</p>}{run.pending.map(p => <Request key={p.id} request={p} busy={busy} onRespond={result => respond(p.id, result)}/>)}<RunStatus status={run.status} activity={currentActivity(run.activities, run.turnId)} outputCount={outputCount} onViewOutput={showOutput}/><div ref={endRef}/></div>{!atLatest && <button className="jump-latest" onClick={jumpToLatest}><ArrowDownToLine size={14}/>Back to latest</button>}<div className="reply-composer"><textarea ref={replyRef} value={reply} onChange={e => setReply(e.target.value)} aria-label="Follow up" placeholder={active(run) ? run.status === 'collecting_output' ? 'Preparing your files for review…' : run.status === 'approval_needed' ? 'Review the approval request above.' : run.status === 'awaiting_input' ? 'Answer Codex’s question above.' : 'Codex is working. You can stop the run below.' : 'Give feedback or ask for the next step…'} rows={3} disabled={active(run)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && reply.trim() && !active(run) && !busy) {
            e.preventDefault();
            send();
        } }}/>{data.capabilities?.attachments && <AttachmentPicker key={run.id} files={replyFiles} onChange={setReplyFiles} disabled={busy || active(run)}/>}<div className="reply-footer"><span className="mono">{active(run) ? 'LIVE SESSION' : '⌘ ENTER TO SEND'}</span>{run.status === 'collecting_output' ? <span className="preparing-output mono"><LoaderCircle size={13} className="spin"/>Preparing outputs…</span> : active(run) ? <button className="text-button" disabled={busy} onClick={() => void act(async () => { setRun(await api<Run>(`/api/runs/${run.id}/interrupt`, {})); await refresh(); })}><Square size={13}/>Stop run</button> : <button className="primary" onClick={send} disabled={busy || !reply.trim() || !ready}>Send<ArrowRight size={16}/></button>}</div></div></section><div className="split-handle" role="separator" aria-label="Resize conversation and preview" aria-orientation="vertical" aria-valuenow={split} aria-valuemin={30} aria-valuemax={70} tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setSplit(s => Math.max(30, Math.min(70, s + (e.key === 'ArrowLeft' ? -2 : 2))));
        } }} onPointerDown={e => { e.preventDefault(); const bounds = e.currentTarget.parentElement!.getBoundingClientRect(); const move = (event: PointerEvent) => setSplit(Math.max(30, Math.min(70, (event.clientX - bounds.left) / bounds.width * 100))); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); }}/><section ref={outputRef} tabIndex={-1} className="inspector" aria-label="Run output"><div className="inspector-tabs"><button className={inspector === 'output' ? 'active' : ''} aria-pressed={inspector === 'output'} onClick={() => { setInspector('output'); setWorkspaceTab('output'); }}><FileText size={15}/>Output{run.artifacts.length > 0 && <span>{outputCount}</span>}</button><button className={inspector === 'activity' ? 'active' : ''} aria-pressed={inspector === 'activity'} onClick={() => { setInspector('activity'); setWorkspaceTab('activity'); }}><Terminal size={15}/>Activity</button></div>{inspector === 'activity' ? <div className="activity-list">{run.activities.length ? run.activities.map(a => <details key={a.id}><summary><span>{a.status === 'completed' ? <Check size={15}/> : <span className="status-dot"/>}</span>{a.label}<span className="activity-state mono">{a.status === 'inProgress' || a.status === 'working' ? 'Working' : titleCase(a.status)}</span></summary><pre>{a.detail || a.status}</pre></details>) : <div className="empty-state"><Terminal size={27}/><h3>The story behind the work.</h3><p>Actions and tool activity will appear here as Codex works.</p></div>}</div> : selectedArtifact ? <><div className="artifact-toolbar"><select aria-label="Select output" value={artifactId} onChange={e => setArtifactId(e.target.value)}>{run.artifacts.map(a => <option key={a.id} value={a.id}>{artifactLabel(a,run.artifacts)}</option>)}</select><a href={`${artifactUrl}?download=1`} download={selectedArtifact.name} aria-label="Download output"><ArrowDownToLine size={16}/></a></div>{<ArtifactPreview url={artifactUrl} artifact={selectedArtifact} imageUrl={companionUrl} files={run.artifacts.map(a => a.name)} workspace={run.cwd} onOpenFile={openFile}/> }</> : <div className="output-empty"><div className="paper-illustration" aria-hidden="true"><FileText size={50} strokeWidth={1}/><span /><span /><span /></div>{active(run) ? <><div className="mono">OUTPUT WORKSPACE</div><h2>Room for<br />your next idea.</h2><p>Files will appear here when the run finishes.<br />Follow progress in the conversation or Activity.</p></> : <><div className="mono">{run.status === 'completed' ? 'CONVERSATION COMPLETE' : labels[run.status] || run.status}</div><h2>{run.status === 'completed' ? 'Your response is ready.' : 'No files from this turn.'}</h2><p>{run.status === 'completed' ? 'This run returned a response in the conversation. Ask a follow-up to keep shaping the work.' : 'Review the conversation before continuing with a follow-up.'}</p><button className="text-button" onClick={showConversation}>Back to conversation<ArrowRight size={15}/></button></>}</div>}</section></div></> : <RunLoadState error={runLoadError} onRetry={()=>setRunLoadAttempt(attempt=>attempt+1)} onBack={()=>navigate('runs')}/>}</main>}
 </div>{palette && <div className="palette-backdrop" onClick={() => setPalette(false)}><section ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Find a skill" onClick={e => e.stopPropagation()}><label><Search size={20}/><input ref={searchRef} aria-label="Find a skill" placeholder="What would you like to make?" value={query} onChange={e => setQuery(e.target.value)}/><button onClick={() => setPalette(false)} aria-label="Close search"><X size={18}/></button></label><div className="palette-results">{allSkills.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map(s => <button key={s.id} onClick={() => choose(s)}><div><strong>{s.name}</strong><span>{s.description}</span></div><ArrowUpRight size={17}/></button>)}</div><footer className="mono">CHOOSE A SKILL TO START <span>ESC TO CLOSE</span></footer></section></div>}
 </div>;
}
function artifactLabel(artifact:{id:string;name:string},artifacts:{id:string;name:string}[]){const versions=artifacts.filter(a=>a.name===artifact.name);if(versions.length===1)return artifact.name;return `${artifact.name} · v${versions.findIndex(a=>a.id===artifact.id)+1}${versions.at(-1)?.id===artifact.id?' (latest)':''}`}

function ArtifactPreview({url,artifact,files,workspace,onOpenFile,imageUrl}:{url:string;imageUrl?:string;artifact:{name:string;type:string};files:string[];workspace:string;onOpenFile:(name:string)=>void}){
 const isMarkdown=/\.md(?:own)?$/i.test(artifact.name)||artifact.type.includes('markdown');
 const [text,setText]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!isMarkdown)return;const abort=new AbortController();setLoading(true);setText('');setError('');fetch(url,{signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error('Could not load this output.');return response.text()}).then(setText).catch(error=>{if(error.name!=='AbortError')setError(error.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[url,isMarkdown]);
 if(isMarkdown)return <div className="artifact-markdown markdown">{loading?<div className="working-label mono"><LoaderCircle size={14} className="spin"/>Opening output…</div>:error?<p role="alert">{error}</p>:<Markdown files={files} workspace={workspace} onOpenFile={onOpenFile}>{text}</Markdown>}</div>;
 if(/\.pdf$/i.test(artifact.name))return <PdfOutput url={url} name={artifact.name} imageUrl={imageUrl}/>;
 if(isTextOutput(artifact.name))return <TextOutput url={url} name={artifact.name}/>;
 if(/image|png|jpe?g|webp|gif/i.test(artifact.type))return <img className="artifact-image" src={url} alt={artifact.name}/>;
 return <>{/\.html?$/i.test(artifact.name) && <p className="preview-note">Safe preview: scripts and companion assets are disabled. Download to use the full report.</p>}<iframe key={url} className="artifact-frame" src={url} sandbox="" title={artifact.name}/></>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
