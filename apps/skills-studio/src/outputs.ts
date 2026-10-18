type Output = { id: string; name: string; collectionId?: string };

/** Preview only a same-directory, same-stem image captured with this PDF revision. */
export function pdfCompanion(artifacts: readonly Output[], selectedId: string): string | undefined {
    const selected = artifacts.find(file => file.id === selectedId);
    if (!selected?.collectionId || artifacts.filter(file => file.name === selected.name).at(-1)?.id !== selectedId) return undefined;
    const name = selected.name;
    if (!/\.pdf$/i.test(name)) return undefined;
    const stem = name.slice(0, -4);
    const formats = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    for (const format of formats) {
        const matches = artifacts.filter(file => {
            const dot = file.name.lastIndexOf('.');
            return file.collectionId === selected.collectionId && file.name.slice(0, dot) === stem && file.name.slice(dot + 1).toLowerCase() === format;
        });
        if (matches.length) return matches.at(-1)?.id;
    }
    return undefined;
}

function priority(name: string) {
    const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
    if (extension === 'html' || extension === 'htm') return 0;
    if (extension === 'pdf') return 1;
    if (['md', 'mdown', 'markdown'].includes(extension || '')) return 2;
    if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(extension || '')) return 3;
    if (['txt', 'rst', 'log'].includes(extension || '')) return 4;
    return 5;
}

function compareNames(first: string, second: string) {
    const a = first.toLowerCase();
    const b = second.toLowerCase();
    return a < b ? -1 : a > b ? 1 : first < second ? -1 : first > second ? 1 : 0;
}

/** Artifacts append revisions chronologically. Call when the artifact list changes,
 * not when the user selects an older revision in the output picker. */
export function pickOutput(artifacts: readonly Output[], currentId?: string): string | undefined {
    const latest = new Map<string, Output>();
    for (const artifact of artifacts) latest.set(artifact.name, artifact);
    const selected = artifacts.find(artifact => artifact.id === currentId);
    if (selected) return latest.get(selected.name)?.id;

    let preferred: Output | undefined;
    for (const artifact of latest.values()) {
        if (!preferred || priority(artifact.name) < priority(preferred.name) ||
            (priority(artifact.name) === priority(preferred.name) && compareNames(artifact.name, preferred.name) < 0)) {
            preferred = artifact;
        }
    }
    return preferred?.id;
}
