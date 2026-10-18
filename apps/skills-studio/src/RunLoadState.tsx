import React from 'react';
import { LoaderCircle } from 'lucide-react';

type RunLoadStateProps = {
    error: string;
    onRetry: () => void;
    onBack: () => void;
};

export function RunLoadState({ error, onRetry, onBack }: RunLoadStateProps) {
    if (!error) return <div className="loading-page" role="status"><LoaderCircle className="spin" aria-hidden="true"/>Opening your run…</div>;
    return <div className="loading-page">
        <h1>Could not open this run.</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onBack}>Back to runs</button>
    </div>;
}
