import React, { useId, useState } from 'react';
import { ArrowDownToLine, FileText, Paperclip, X } from 'lucide-react';

export const attachmentLimits = { maxFiles: 5, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 };
export type SavedAttachment = { id: string; name: string; size: number; type: 'image' | 'file'; file: string };
export const fileSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export function selectAttachments(current: File[], incoming: File[]) {
    const files = [...current], errors: string[] = [];
    for (const file of incoming) {
        if (files.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) continue;
        if (file.size > attachmentLimits.maxFileBytes) errors.push(`${file.name} exceeds 10 MB.`);
        else if (files.length >= attachmentLimits.maxFiles) errors.push(`${file.name} was not added. Choose up to 5 files.`);
        else if (files.reduce((total, item) => total + item.size, 0) + file.size > attachmentLimits.maxTotalBytes) errors.push(`${file.name} was not added. Files must total 20 MB or less.`);
        else files.push(file);
    }
    return { files, error: errors.join(' ') };
}

export async function encodeAttachments(files: File[]) {
    return Promise.all(files.map(file => new Promise<{ name: string; data: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== 'string' || !reader.result.includes(',')) return reject(new Error(`Could not read ${file.name}. Please select it again.`));
            resolve({ name: file.name, data: reader.result.slice(reader.result.indexOf(',') + 1) });
        };
        reader.onerror = reader.onabort = () => reject(new Error(`Could not read ${file.name}. Please select it again.`));
        reader.readAsDataURL(file);
    })));
}

export function AttachmentPicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
    const id = useId(), [error, setError] = useState('');
    return <div className="attachments-composer">
        <div className="attachment-controls"><label className={`attach-button ${disabled ? 'disabled' : ''}`} htmlFor={id}><Paperclip size={15}/><span>Attach files</span><input id={id} type="file" multiple disabled={disabled} aria-label="Attach files" onChange={event => {
            const result = selectAttachments(files, Array.from(event.target.files || []));
            onChange(result.files); setError(result.error); event.target.value = '';
        }}/></label><span className="attachment-limit">Up to 5 files · 10 MB each · 20 MB total</span></div>
        {files.length > 0 && <ul className="attachment-list" aria-label="Selected files">{files.map((file, index) => <li key={`${file.name}:${file.lastModified}:${index}`}><FileText size={15}/><span className="attachment-name">{file.name}</span><span className="attachment-size">{fileSize(file.size)}</span><button disabled={disabled} onClick={() => { onChange(files.filter((_, i) => i !== index)); setError(''); }} aria-label={`Remove ${file.name}`}><X size={14}/></button></li>)}</ul>}
        {error && <p className="attachment-error" role="alert">{error}</p>}
        <p className="attachment-note">Files are saved locally and made available to Codex when you send.</p>
    </div>;
}

export function MessageAttachments({ runId, attachments }: { runId: string; attachments: SavedAttachment[] }) {
    if (!attachments.length) return null;
    return <ul className="attachment-list saved-attachments" aria-label="Attached files">{attachments.map(attachment => <li key={attachment.id}><FileText size={15}/><a className="attachment-name" href={`/api/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(attachment.id)}?download=1`} download={attachment.name}>{attachment.name}<ArrowDownToLine size={13}/></a><span className="attachment-size">{fileSize(attachment.size)}</span></li>)}</ul>;
}
