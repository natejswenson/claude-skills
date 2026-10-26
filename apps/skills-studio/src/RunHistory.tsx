import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, FileText, History, LoaderCircle, Plus, Search } from 'lucide-react';
import { createRefreshQueue, runLabels, formatRunDate, type HistoryPage } from './history';

type Skills = readonly { id: string; name: string }[];
type Actions = { skills: Skills; busy: boolean; onOpen: (id: string) => void; onAgain: (id: string) => void };

export function RunHistoryResults({ page, offset, onPage, skills, busy, onOpen, onAgain }: Actions & { page: HistoryPage; offset: number; onPage: (offset: number) => void }) {
    return <><p className="fine-print" role="status">Showing {offset + 1}–{offset + page.runs.length} of {page.total} matching runs</p><div className="run-list">{page.runs.map(run => <div className="history-row" key={run.id}><button className="run-row" disabled={busy} onClick={()=>onOpen(run.id)}><FileText size={21}/><div><strong>{run.title}</strong><span>{run.skillId ? skills.find(skill=>skill.id===run.skillId)?.name || run.skillId : 'Open task'} · {formatRunDate(run.createdAt)}</span></div><span className="mono run-status">{runLabels[run.status] || run.status}</span><ArrowUpRight size={19}/></button><button className="run-again text-button" disabled={busy} onClick={()=>onAgain(run.id)}>Run again<ArrowRight size={13}/></button></div>)}</div><div className="section-heading"><button className="text-button" disabled={offset===0 || busy} onClick={()=>onPage(Math.max(0,offset-50))}>Previous</button><button className="text-button" disabled={page.nextOffset===null || busy} onClick={()=>onPage(page.nextOffset!)}>Next</button></div></>;
}

export function RunHistory({ totalCount, revision, onNew, ...actions }: Actions & { totalCount: number; revision: string; onNew: () => void }) {
    const [query,setQuery]=useState(''), [offset,setOffset]=useState(0), [page,setPage]=useState<HistoryPage|null>(null), [error,setError]=useState(''), [attempt,setAttempt]=useState(0);
    const reload = useRef<(() => Promise<void>) | null>(null), lastRevision = useRef(revision);
    useEffect(()=>{
        const abort=new AbortController();setPage(null);setError('');
        const refresh=createRefreshQueue(async()=>{
            if(abort.signal.aborted)return;
            try {
                const response=await fetch(`/api/runs?query=${encodeURIComponent(query)}&offset=${offset}`,{signal:abort.signal});
                const result=await response.json() as HistoryPage & {error?:string};
                if(!response.ok)throw new Error(result.error || 'Could not load your runs.');
                if(!abort.signal.aborted){
                    setError('');
                    if(result.total>0 && !result.runs.length && offset>0)setOffset(Math.floor((result.total-1)/50)*50);
                    else setPage(result);
                }
            } catch(error) {if(!abort.signal.aborted)setError(error instanceof Error?error.message:'Could not load your runs.');}
        });
        reload.current=refresh;
        const timer=setTimeout(()=>{void refresh();},200);
        return()=>{clearTimeout(timer);abort.abort();if(reload.current===refresh)reload.current=null;};
    },[query,offset,attempt]);
    useEffect(()=>{if(lastRevision.current!==revision){lastRevision.current=revision;void reload.current?.();}},[revision]);
    const clear=()=>{setQuery('');setOffset(0);};
    return <main className="standard-page"><div className="page-heading"><div className="eyebrow">Your work, kept close</div><h1>Good ideas.<br/>Real outcomes.</h1><p className="standfirst">Pick up where you left off, or start something new.</p></div><div className="section-heading"><h2>Your runs<span className="count">{totalCount}</span></h2><button className="text-button" disabled={actions.busy} onClick={onNew}><Plus size={16}/>New run</button></div>{totalCount ? <><label className="history-search library-search"><Search size={16}/><input value={query} onChange={event=>{setQuery(event.target.value);setOffset(0);}} placeholder="Search your runs" aria-label="Search your runs"/></label>{error ? <div className="empty-state"><p role="alert">{error}</p><button className="text-button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></div> : !page ? <p role="status"><LoaderCircle className="spin" size={16}/>Loading your runs…</p> : page.runs.length ? <RunHistoryResults {...actions} page={page} offset={offset} onPage={setOffset}/> : <div className="empty-state"><Search size={25}/><h3>No matching runs.</h3><button onClick={clear}>Clear search</button></div>}</> : <div className="empty-state roomy"><History size={32}/><h2>A clean slate.</h2><p>Your runs and finished work will appear here.</p><button className="primary" onClick={onNew}>Explore the library<ArrowRight size={16}/></button></div>}</main>;
}
