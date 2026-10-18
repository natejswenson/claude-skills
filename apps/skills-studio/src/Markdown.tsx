import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children }: { children: string }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div> }}>{children}</ReactMarkdown>;
}
