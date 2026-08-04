/**
 * The press-styled sheet.
 *
 * The numbers strip is computed here from the corpus, never taken from the
 * draft: a figure the model typed is a figure the model could have invented,
 * and there is no receipt shape for "12".
 */
import { readFileSync } from 'node:fs';
import { appendix } from './receipts.mjs';
import { collapseReleaseSeries, foldSquashCommits } from './rank.mjs';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only <em> survives from the draft's prose, and only in the headline. */
const inlineEm = (s) => esc(s).replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');

const day = (iso) => String(iso ?? '').slice(0, 10);

const KIND_LABEL = { pr: 'pull request', commit: 'commit', release: 'release', session: 'session' };

/**
 * The strip describes the WINDOW, not the citations.
 *
 * It was computed from the cited items at first, and the first real run showed
 * why that is wrong: the sheet read "10 released" directly above a sentence
 * saying thirty-three had been. A summary cites a handful of things and is
 * still *about* the whole window, so the strip has to count the whole window or
 * it quietly contradicts the prose it sits under.
 *
 * Releases are counted as collapsed series, so this figure and `rank`'s agree.
 */
export function computeNumbers(windowItems) {
  const series = collapseReleaseSeries(windowItems);
  const { kept } = foldSquashCommits(series);
  const n = (k) => kept.filter((i) => i.kind === k).length;
  const repos = new Set(kept.filter((i) => i.repo).map((i) => i.repo));
  const out = [
    { k: 'released', n: n('release'), hot: n('release') > 0 },
    { k: 'merged', n: n('pr') },
    { k: 'commits', n: n('commit') },
    { k: 'sessions', n: n('session') },
    { k: 'repos', n: repos.size },
  ];
  return out.filter((x) => x.n > 0);
}

const citeUrl = (item) => item?.url ?? null;

const citeLabel = (receipt) => {
  if (receipt.startsWith('pr:')) return receipt.replace(/^pr:.*#/, 'PR #');
  if (receipt.startsWith('release:')) return receipt.replace(/^release:.*@/, '');
  if (receipt.startsWith('commit:')) return receipt.replace(/^commit:.*@/, '');
  if (receipt.startsWith('session:')) return `session ${receipt.slice(8, 16)}`;
  return receipt;
};

export function renderHtml({ draft, corpus, window: win, items, cssPath, stamp = 'NS', byline = '' }) {
  const css = readFileSync(cssPath, 'utf8');
  const numbers = computeNumbers(items);
  const cites = appendix(draft, corpus);

  const numbersHtml = numbers.length === 0 ? '' : `
    <div class="numbers">
${numbers.map((x) => `      <div><div class="n${x.hot ? ' hot' : ''}">${esc(x.n)}</div><div class="k">${esc(x.k)}</div></div>`).join('\n')}
    </div>`;

  const sectionsHtml = (draft.sections ?? []).map((s) => `
    <section>
      <h2>${esc(s.title)}</h2>
${(s.items ?? []).map((it) => `      <div class="item">
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.text)}</p>
        <div class="cites">${(it.receipts ?? []).map((r) => {
    const hit = corpus.github[r] ?? corpus.sessions[r] ?? null;
    const url = citeUrl(hit);
    return url
      ? `<a class="cite" href="${esc(url)}">${esc(citeLabel(r))}</a>`
      : `<span class="cite">${esc(citeLabel(r))}</span>`;
  }).join('')}</div>
      </div>`).join('\n')}
    </section>`).join('\n');

  const appendixHtml = cites.length === 0 ? '' : `
    <section class="receipts">
      <h2>Receipts</h2>
      <table>
        <thead><tr><th>id</th><th>what</th><th>when</th></tr></thead>
        <tbody>
${cites.map(({ receipt, item }) => `          <tr><td class="id">${esc(citeLabel(receipt))}</td><td>${item.url ? `<a href="${esc(item.url)}">${esc(item.title)}</a>` : esc(item.title)}<br><span style="color:var(--dim)">${esc(KIND_LABEL[item.kind] ?? item.kind)}${item.repo ? ` · ${esc(item.repo)}` : ''}${item.project ? ` · ${esc(item.project)}` : ''}</span></td><td class="id">${esc(day(item.at))}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </section>`;

  const standfirstHtml = (draft.standfirst ?? []).map((p) => `      <p>${esc(p)}</p>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(draft.title ?? 'Shipped')} — ${esc(day(win.since))} to ${esc(day(win.until))}</title>
<style>
${css}
</style>
</head>
<body>
  <main class="sheet">
    <header class="masthead">
      <h1>${esc(draft.title ?? 'Shipped')}</h1>
      <div class="window">${esc(day(win.since))} → ${esc(day(win.until))}</div>
    </header>

    <p class="headline">${inlineEm(draft.headline ?? '')}</p>

    <div class="standfirst">
${standfirstHtml}
    </div>
${numbersHtml}
${sectionsHtml}
${appendixHtml}

    <footer class="colophon">
      <span class="stamp">${esc(stamp)}</span>
      <span>${esc(byline)}</span>
    </footer>
  </main>
</body>
</html>
`;
}
