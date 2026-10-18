import React from 'react';
import { ArrowDownToLine, FileText } from 'lucide-react';

export function PdfOutput({ url, name, imageUrl }: { url: string; name: string; imageUrl?: string }) {
    return <div className="pdf-output">
        {imageUrl ? <><p className="preview-note">Companion image preview. Download the PDF for the complete document.</p><img className="artifact-image" src={imageUrl} alt={`Companion preview for ${name}`}/></> : <div className="empty-state"><FileText size={32}/><h2>Your PDF is ready.</h2><p>Download to view and print the complete document.</p></div>}
        <a className="text-button pdf-download" href={`${url}?download=1`} download={name}>Download PDF<ArrowDownToLine size={16}/></a>
    </div>;
}
