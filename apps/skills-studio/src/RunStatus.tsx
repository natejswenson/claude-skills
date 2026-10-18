import React from 'react';
import { ArrowRight } from 'lucide-react';

export function currentActivity(activities: { label: string; status: string; turnId?: string | null }[], turnId?: string | null) {
    if (!turnId) return undefined;
    return activities.filter(activity => activity.turnId === turnId && ['working', 'inProgress'].includes(activity.status)).at(-1);
}

type RunStatusProps = {
    status: string;
    activity?: { label: string };
    outputCount?: number;
    onViewOutput: () => void;
};

export function RunStatus({ status, activity, outputCount = 0, onViewOutput }: RunStatusProps) {
    const hasOutput = status === 'completed' && outputCount > 0;
    const states: Record<string, { headline: string; guidance: string }> = {
        working: {
            headline: 'Codex is working',
            guidance: activity?.label || 'Follow the conversation or activity as Codex works.',
        },
        approval_needed: {
            headline: 'Your approval is needed',
            guidance: 'Review the requested action in the conversation before continuing.',
        },
        awaiting_input: {
            headline: 'Codex has a question',
            guidance: 'Answer in the conversation to continue.',
        },
        completed: {
            headline: hasOutput ? 'Ready to review' : 'Response ready',
            guidance: hasOutput ? `${outputCount} finished ${outputCount === 1 ? 'file' : 'files'}. Review your output or continue with a follow-up.` : 'Continue with a follow-up in the conversation.',
        },
        stopped: {
            headline: 'Run stopped',
            guidance: 'Send a follow-up when you want to continue.',
        },
        interrupted: {
            headline: 'Run interrupted',
            guidance: 'The session ended before it finished. Send a follow-up to continue.',
        },
        failed: {
            headline: 'Run failed',
            guidance: 'Review the error in the conversation, then send a follow-up to try again.',
        },
    };
    const current = states[status] || {
        headline: 'Run status unavailable',
        guidance: 'Check the conversation and activity for details.',
    };
    return <section className="run-status-panel" aria-label="Run status">
        <div className="run-status-copy" role="status" aria-live="polite">
            <h2>{current.headline}</h2>
            <p>{current.guidance}</p>
        </div>
        {hasOutput && <button type="button" className="text-button" onClick={onViewOutput}>View output<ArrowRight size={15} aria-hidden="true"/></button>}
    </section>;
}

export type WorkspaceTab = 'conversation' | 'output' | 'activity';
type WorkspaceTabsProps = {
    tab: WorkspaceTab;
    onChange: (tab: WorkspaceTab) => void;
    outputCount: number;
    activityCount: number;
    attention?: boolean;
};

export function WorkspaceTabs({ tab, onChange, outputCount, activityCount, attention = false }: WorkspaceTabsProps) {
    return <nav className="workspace-tabs" aria-label="Workspace views">
        <button type="button" aria-pressed={tab === 'conversation'} onClick={() => onChange('conversation')}>Conversation{attention && <span className="tab-attention" aria-label="Action needed" title="Action needed">!</span>}</button>
        <button type="button" aria-pressed={tab === 'output'} onClick={() => onChange('output')}>Output <span>{outputCount}</span></button>
        <button type="button" aria-pressed={tab === 'activity'} onClick={() => onChange('activity')}>Activity <span>{activityCount}</span></button>
    </nav>;
}
