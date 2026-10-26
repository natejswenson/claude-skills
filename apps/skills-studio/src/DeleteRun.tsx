import React from 'react';

type DeletableRun = { id: string; title: string; status: string };
export function DeleteRun({ run, busy, onDelete }: { run: DeletableRun; busy: boolean; onDelete: (run: DeletableRun) => void }) {
    const disabled = busy || ['working', 'awaiting_input', 'approval_needed', 'collecting_output'].includes(run.status);
    return <button className="text-button" disabled={disabled} onClick={() => onDelete(run)}>Delete run</button>;
}

type DeleteOptions = {
    confirm: (message: string) => boolean;
    request?: typeof fetch;
    onStart: () => void;
    onDeleted: () => void | Promise<void>;
    onError: (message: string) => void;
    onFinish: () => void;
};
export async function deleteRun(run: DeletableRun, { confirm, request = fetch, onStart, onDeleted, onError, onFinish }: DeleteOptions) {
    if (!confirm(`Delete “${run.title}”?\n\nThis permanently removes this run and its Studio attachment and output copies. Source workspace files and native Codex history remain preserved.`)) return;
    onStart();
    try {
        const response = await request(`/api/runs/${encodeURIComponent(run.id)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Deletion failed (${response.status}). Try again.`);
        await onDeleted();
    } catch (error) { onError((error as Error).message); }
    finally { onFinish(); }
}
