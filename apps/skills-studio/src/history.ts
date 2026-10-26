type SearchableRun = {
    title: string;
    skillId?: string | null;
    messages: readonly { text: string }[];
};

export function matchesRun(run: SearchableRun, query: string): boolean {
    const search = query.trim().toLowerCase();
    return !search || [run.title, run.skillId || '', ...run.messages.map(message => message.text)]
        .some(text => text.toLowerCase().includes(search));
}

/** Cancelling a selection prevents its late response or failure replacing the current view. */
export function loadSelectedRun<T>(load: () => Promise<T>, handlers: {
    onLoad: (run: T) => void;
    onError: (error: string) => void;
}): () => void {
    let cancelled = false;
    void load().then(run => {
        if (!cancelled) handlers.onLoad(run);
    }, error => {
        if (!cancelled) handlers.onError(error instanceof Error ? error.message : 'Could not load this run.');
    });
    return () => { cancelled = true; };
}


/** Coalesce bursts and serialize refreshes so a slow response cannot overlap a newer one. */
export function createRefreshQueue(task: () => Promise<void>): () => Promise<void> {
    type Batch = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
    let running = false, pending: Batch | null = null;
    const batch = (): Batch => {
        let resolve!: () => void, reject!: (error: unknown) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
    };
    const start = (current: Batch) => {
        running = true;
        void (async () => {
            try { await task(); current.resolve(); }
            catch (error) { current.reject(error); }
            finally {
                if (pending) { const next = pending; pending = null; start(next); }
                else running = false;
            }
        })();
    };
    return () => {
        if (running) return (pending ||= batch()).promise;
        const current = batch(); start(current); return current.promise;
    };
}

export const runLabels: Record<string, string> = { collecting_output: 'Preparing outputs', working: 'Working', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted', awaiting_input: 'Your answer needed', approval_needed: 'Approval needed' };
export const formatRunDate = (s: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(s));

export type RunSummary = { id: string; title: string; skillId?: string | null; status: string; createdAt: string; updatedAt: string; model?: string | null };
export type HistoryPage = { runs: RunSummary[]; total: number; nextOffset: number | null };
