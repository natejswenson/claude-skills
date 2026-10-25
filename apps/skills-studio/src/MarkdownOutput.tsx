import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Markdown } from './Markdown';
import { loadMarkdownOutput, type MarkdownPreview } from './markdown-output';

type Props = { url: string; name: string; files?: string[]; workspace?: string; onOpenFile?: (name: string) => void };

export function MarkdownContent({ preview, url, name, ...markdown }: Props & { preview: MarkdownPreview }) {
    return <>{preview.truncated && <p className="preview-note">Partial preview: showing the first 64 KiB of this file. <a href={`${url}?download=1`} download={name}>Download the complete file</a>.</p>}<Markdown {...markdown}>{preview.text}</Markdown></>;
}

export function MarkdownOutput({ url, ...props }: Props) {
    const [preview, setPreview] = useState<MarkdownPreview | null>(null), [error, setError] = useState('');
    useEffect(() => {
        setPreview(null); setError('');
        return loadMarkdownOutput(signal => fetch(url, { signal }), { onLoad: setPreview, onError: setError });
    }, [url]);
    return <div className="artifact-markdown markdown">{error ? <p className="preview-note" role="alert">{error}</p> : preview ? <MarkdownContent {...props} url={url} preview={preview}/> : <div className="working-label mono"><LoaderCircle size={14} className="spin"/>Opening output…</div>}</div>;
}
