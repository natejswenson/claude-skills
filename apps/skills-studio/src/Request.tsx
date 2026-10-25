import React, { useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';

type Question = {
    id: string;
    question?: string;
    header?: string;
    isSecret?: boolean;
    options?: { label: string; description?: string }[] | null;
};
type RequestProps = {
    request: { id: string; method: string; params: any };
    busy: boolean;
    onRespond: (result: unknown) => void;
};

export function Request({ request, busy, onRespond }: RequestProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const params = request.params || {};
    const questions: Question[] = params.questions || [];
    const isQuestion = ['item/tool/requestUserInput', 'tool/requestUserInput'].includes(request.method);
    const isCommand = request.method === 'item/commandExecution/requestApproval';
    const isFile = request.method === 'item/fileChange/requestApproval';
    const network = isCommand ? params.networkApprovalContext : null;
    const supported = isQuestion || isCommand || isFile;
    const title = isQuestion ? 'Your direction is needed.' : network ? 'Allow network access?' : isCommand ? 'Allow this command?' : isFile ? 'Allow these file changes?' : 'Unsupported request';
    const decisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : ['accept', 'decline'];
    const canAccept = decisions.includes('accept');
    const denyDecision = decisions.includes('decline') ? 'decline' : decisions.includes('cancel') ? 'cancel' : null;
    const changes: string = typeof params.proposedChanges === 'string' ? params.proposedChanges : '';
    return <section className="approval-panel" aria-label={title}>
        <div className="mono">{isQuestion ? 'YOUR INPUT NEEDED' : 'PERMISSION REQUEST'}</div>
        <h3>{title}</h3>
        {isQuestion ? <form onSubmit={e => {
            e.preventDefault();
            onRespond({ answers: Object.fromEntries(questions.map(q => [q.id, { answers: [answers[q.id] || ''] }])) });
        }}>
            {questions.map(q => <fieldset key={q.id} disabled={busy}>
                <legend>{q.question || q.header}</legend>
                {!q.isSecret && q.options?.map(o => <label className="question-option" key={o.label}>
                    <input type="radio" name={q.id} value={o.label} checked={answers[q.id] === o.label} onChange={() => setAnswers(a => ({ ...a, [q.id]: o.label }))}/>
                    <span><strong>{o.label}</strong>{o.description && <small>{o.description}</small>}</span>
                </label>)}
                <input type={q.isSecret ? 'password' : 'text'} autoComplete="off" aria-label={`Your answer: ${q.question || q.header}`} placeholder={!q.isSecret && q.options?.length ? 'Or write your own answer…' : 'Your answer…'} value={!q.isSecret && q.options?.some(o => o.label === answers[q.id]) ? '' : answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}/>
            </fieldset>)}
            <button className="text-button" disabled={busy || !questions.length || !questions.every(q => answers[q.id]?.trim())}>Continue<ArrowRight size={15}/></button>
        </form> : <>
            {params.reason && <p className="approval-reason">{params.reason}</p>}
            {network && <dl className="approval-facts">
                <div><dt>Host</dt><dd>{network.host || 'Not provided'}</dd></div>
                <div><dt>Protocol</dt><dd>{network.protocol || 'Not provided'}</dd></div>
            </dl>}
            {isCommand && <>
                <div className="approval-command"><span className="mono">COMMAND</span>{params.command ? <pre>{params.command}</pre> : <p>Command details were not provided.</p>}</div>
                <dl className="approval-facts"><div><dt>Working directory</dt><dd>{params.cwd || 'Not provided'}</dd></div></dl>
            </>}
            {isFile && <>
                <div className="approval-command"><span className="mono">PROPOSED CHANGES</span>{changes ? <pre className="approval-diff" aria-label="Proposed file changes">{changes.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'diff-addition' : line.startsWith('-') ? 'diff-removal' : ''}>{line}{'\n'}</span>)}</pre> : <p>A file diff was not provided. Review the technical details before allowing changes.</p>}</div>
                {params.grantRoot && <dl className="approval-facts"><div><dt>Requested write access (session)</dt><dd>{params.grantRoot}</dd></div></dl>}
            </>}
            {!supported && <p>This request cannot be approved in Skills Studio.</p>}
            <details className="approval-technical"><summary>Technical request details</summary><pre>{JSON.stringify(params, null, 2)}</pre></details>
            {supported && <div className="approval-actions">{denyDecision && <button className="text-button" disabled={busy} onClick={() => onRespond({ decision: denyDecision })}>{denyDecision === 'cancel' ? 'Decline and stop' : 'Decline'}<X size={15}/></button>}{canAccept && <button className="text-button" disabled={busy} onClick={() => onRespond({ decision: 'accept' })}>Allow this action<Check size={15}/></button>}{!canAccept && !denyDecision && <p>No supported decision is available. Use Stop run to end this request.</p>}</div>}
        </>}
    </section>;
}
