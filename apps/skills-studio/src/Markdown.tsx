import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = { children: string; files?: string[]; workspace?: string; onOpenFile?: (name: string) => void };

export function Markdown({ children, files = [], workspace, onOpenFile }: Props) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
        a: ({ href, children, node, ...props }) => {
            let path = href;
            try { path = decodeURIComponent(href || ''); } catch { /* Leave malformed links unchanged. */ }
            const file = files.find(name => path === name || path === `./${name}` || (workspace && path === `${workspace}/${name}`));
            return file && onOpenFile ? <button className="inline-file" type="button" onClick={() => onOpenFile(file)}>{children}</button> : <a {...props} href={href} onClick={event => {
                if (!path?.startsWith('#')) return;
                event.preventDefault();
                const scope = event.currentTarget.closest('.markdown');
                Array.from(scope?.querySelectorAll<HTMLElement>('[id]') || []).find(target => target.id === path.slice(1))?.scrollIntoView({ block: 'nearest' });
            }}>{children}</a>;
        },
    }}>{children}</ReactMarkdown>;
}
