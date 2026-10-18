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
