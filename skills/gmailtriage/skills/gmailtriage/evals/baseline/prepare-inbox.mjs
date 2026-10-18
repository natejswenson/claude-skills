/**
 * An explicit invented pre-triage scenario, derived from the archival corpus.
 * Remove user folders and place these synthetic threads in INBOX; preserve
 * system/category markers. This never changes the shared archival/audit inputs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SYSTEM_LABELS } from '../../scripts/lib/rules.mjs';

export const prepareInbox = (threads) => threads.map((t) => ({
  ...t,
  labelIds: [...new Set(['INBOX', ...(t.labelIds ?? []).filter((l) =>
    SYSTEM_LABELS.includes(l) || l.startsWith('CATEGORY_'))])],
  labels: ['INBOX'],
}));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareInbox(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
}
