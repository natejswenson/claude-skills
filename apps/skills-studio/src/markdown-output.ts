const previewLimit = 64 * 1024;
export type MarkdownPreview = { text: string; truncated: boolean };

/** Read only a bounded UTF-8 prefix; the download remains the original artifact. */
export async function readMarkdownPreview(response: Response, signal?: AbortSignal): Promise<MarkdownPreview> {
    if (!response.ok) throw new Error('Could not load this output. Try selecting it again or download the file.');
    if (!response.body) throw new Error('Streaming preview is unavailable. Download the file for the complete content.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    let text = '', size = 0;
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            signal?.throwIfAborted();
            if (done) return { text: text + decoder.decode(), truncated: false };
            const remaining = previewLimit - size;
            text += decoder.decode(value.subarray(0, remaining), { stream: true });
            size += Math.min(value.byteLength, remaining);
            if (value.byteLength > remaining) {
                cancel();
                // Do not flush an incomplete UTF-8 character at the preview boundary.
                return { text, truncated: true };
            }
        }
    } finally {
        signal?.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}

/** Cleanup aborts transport and prevents late success or error from replacing a new selection. */
export function loadMarkdownOutput(load: (signal: AbortSignal) => Promise<Response>, handlers: {
    onLoad: (preview: MarkdownPreview) => void;
    onError: (error: string) => void;
}): () => void {
    const abort = new AbortController();
    void (async () => {
        try {
            const preview = await readMarkdownPreview(await load(abort.signal), abort.signal);
            if (!abort.signal.aborted) handlers.onLoad(preview);
        } catch (error) {
            if (!abort.signal.aborted) handlers.onError(error instanceof Error ? error.message : 'Could not load this output. Download the file for the complete content.');
        }
    })();
    return () => abort.abort();
}
