import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

const limit = 200000;
export const isTextOutput = (name: string) => /\.(?:json|csv|txt|ts|tsx|js|mjs|css|py|ya?ml)$/i.test(name);
export function formatTextOutput(source: string, name: string) {
    let text = source;
    if (/\.json$/i.test(name)) {
        try { text = JSON.stringify(JSON.parse(source), null, 2); } catch { /* Invalid JSON remains readable as source. */ }
    }
    return { text: text.slice(0, limit), truncated: text.length > limit };
}

export function TextContent({ source, name }: { source: string; name: string }) {
    const { text, truncated } = formatTextOutput(source, name);
    return <div className="text-output">{truncated && <p className="preview-note">Showing the first 200,000 characters. Download the file for the complete content.</p>}<pre tabIndex={0} aria-label={`${name} content`}>{text}</pre></div>;
}

export function TextOutput({ url, name }: { url: string; name: string }) {
    const [text, setText] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => {
        const abort = new AbortController(); setLoading(true); setText(''); setError('');
        fetch(url, { signal: abort.signal }).then(async response => { if (!response.ok) throw new Error('Could not load this output. Try selecting it again or download the file.'); return response.text(); }).then(setText).catch(error => { if (error.name !== 'AbortError') setError(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => abort.abort();
    }, [url]);
    if (loading) return <div className="working-label mono"><LoaderCircle size={14} className="spin"/>Opening output…</div>;
    return error ? <p className="preview-note" role="alert">{error}</p> : <TextContent source={text} name={name}/>;
}
