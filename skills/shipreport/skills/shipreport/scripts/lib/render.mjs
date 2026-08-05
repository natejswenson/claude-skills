/**
 * The press-styled sheet.
 *
 * Composed from the named component vocabulary in press's `brand/components.md`
 * — masthead, headline, standfirst, big stat, stat strip, ledger, data table,
 * colophon — because those names are the contract that makes this sheet and a
 * dev-log card read as the same publication.
 *
 * Two laws bind the markup rather than the CSS, so they are stated here too:
 * the accent is spent exactly twice (the stamp, and the hero figure), and
 * structure is carried by rules and whitespace — this file never emits a
 * container to group things.
 */
import { readFileSync } from 'node:fs';
import { appendix } from './receipts.mjs';
import { collapseReleaseSeries, foldSquashCommits, dropForeignReleases } from './rank.mjs';
import { validateDraftArt } from './art.mjs';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const day = (iso) => String(iso ?? '').slice(0, 10);

/**
 * Drafts used to mark an accent pivot in the headline with <em>. The accent is
 * now spent on the stamp and the hero figure, which is the two the law allows,
 * so a third would break it — the tag is stripped rather than rendered, so an
 * older draft degrades to clean text instead of printing markup.
 */
const stripTags = (s) => {
  let out = String(s ?? '');
  let prev;
  do { prev = out; out = out.replace(/<[^>]*>/g, ''); } while (out !== prev);
  return out;
};

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
 * Releases are counted as collapsed series AND filtered by ownership, so this
 * figure and `rank`'s agree. They did not once: the strip read 21 released
 * where rank had found 19, because the ownership filter lived only in rank and
 * the strip was still counting two external projects' releases.
 */
export function computeNumbers(windowItems, owners = null) {
  const { kept: owned } = dropForeignReleases(windowItems, owners);
  const series = collapseReleaseSeries(owned);
  const { kept } = foldSquashCommits(series);
  const n = (k) => kept.filter((i) => i.kind === k).length;
  const repos = new Set(kept.filter((i) => i.repo).map((i) => i.repo));
  const out = [
    { k: 'released', n: n('release') },
    { k: 'merged', n: n('pr') },
    { k: 'commits', n: n('commit') },
    { k: 'sessions', n: n('session') },
    { k: 'repos', n: repos.size },
  ];
  return out.filter((x) => x.n > 0);
}

/**
 * The hero is whichever figure the window actually turned on: releases if
 * anything shipped, otherwise merged work, otherwise sessions. A zero hero is
 * never printed — a week where nothing shipped says so in the prose, not with a
 * giant nought.
 */
export function heroFigure(numbers) {
  for (const key of ['released', 'merged', 'sessions', 'commits']) {
    const hit = numbers.find((x) => x.k === key);
    if (hit && hit.n > 0) return hit;
  }
  return null;
}

const citeLabel = (receipt) => {
  if (receipt.startsWith('pr:')) return receipt.replace(/^pr:.*#/, 'PR #');
  if (receipt.startsWith('release:')) return receipt.replace(/^release:.*@/, '');
  if (receipt.startsWith('commit:')) return receipt.replace(/^commit:.*@/, '');
  if (receipt.startsWith('session:')) return `session ${receipt.slice(8, 16)}`;
  return receipt;
};

const lookup = (corpus, r) => corpus.github[r] ?? corpus.sessions[r] ?? null;

export function renderHtml({ draft, corpus, window: win, items, cssPath, stamp = 'NS', byline = '', owners = null }) {
  const css = readFileSync(cssPath, 'utf8');
  const numbers = computeNumbers(items, owners);
  const hero = heroFigure(numbers);
  const cites = appendix(draft, corpus);

  const strip = numbers.filter((x) => !hero || x.k !== hero.k);

  const heroHtml = !hero ? '' : `
    <div class="hero">
      <div class="bigstat">
        <div class="fig">${esc(hero.n)}</div>
        <div class="kicker">${esc(hero.k)}</div>
      </div>
      <div class="stat-strip">
${strip.map((x) => `        <div class="stat"><div class="value">${esc(x.n)}</div><div class="label">${esc(x.k)}</div></div>`).join('\n')}
      </div>
    </div>`;

  // Every card's scene is validated before a byte is written, so a report can
  // never half-render with one illustration missing.
  validateDraftArt(draft);

  const sectionsHtml = (draft.sections ?? []).map((s) => {
    const rows = (s.items ?? []).map((it) => {
      const receipts = it.receipts ?? [];
      const citesHtml = receipts.map((r) => {
        const hit = lookup(corpus, r);
        return hit?.url
          ? `<a class="cite" href="${esc(hit.url)}">${esc(citeLabel(r))}</a>`
          : `<span class="cite">${esc(citeLabel(r))}</span>`;
      }).join('');
      return `        <article class="lrow">
          <figure class="art">${it.art}</figure>
          <h3 class="lt">${esc(it.title)}</h3>
          <p class="le">${esc(it.text)}</p>
          <div class="cites">${citesHtml}</div>
        </article>`;
    }).join('\n');

    // The column count fits the section rather than the other way round.
    //
    // A fixed three-column grid orphans a four-item section: three cards, then
    // one alone with two empty columns beside it and the row's full height of
    // white. It reads as a section that failed to finish rather than as a
    // deliberate ragged edge. Two and four both divide cleanly by two; one is
    // left narrow on purpose, because a lone card stretched across the page
    // stretches its scene with it.
    const n = (s.items ?? []).length;
    const cols = (n === 2 || n === 4) ? ' ledger--pairs' : '';

    return `
    <section class="report-section">
      <h2 class="block-title"><span>${esc(s.title)}</span><span class="count">${n}</span></h2>
      <div class="ledger${cols}">
${rows}
      </div>
    </section>`;
  }).join('\n');

  const appendixHtml = cites.length === 0 ? '' : `
    <section class="report-section">
      <h2 class="block-title"><span>Receipts</span><span class="count">${cites.length}</span></h2>
      <table class="data">
        <thead><tr><th>id</th><th>what</th><th>when</th></tr></thead>
        <tbody>
${cites.map(({ receipt, item }) => `          <tr><td class="id">${esc(citeLabel(receipt))}</td><td>${item.url ? `<a href="${esc(item.url)}">${esc(item.title)}</a>` : esc(item.title)}<br><span class="sub">${esc(KIND_LABEL[item.kind] ?? item.kind)}${item.repo ? ` · ${esc(item.repo)}` : ''}${item.project ? ` · ${esc(item.project)}` : ''}</span></td><td class="id">${esc(day(item.at))}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </section>`;

  const standfirstHtml = (draft.standfirst ?? []).map((p) => `      <p>${esc(p)}</p>`).join('\n');
  const title = draft.title ?? 'Shipped';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(day(win.since))} to ${esc(day(win.until))}</title>
<style>
${css}
</style>
</head>
<body>
  <main class="sheet">
    <header class="masthead">
      <div class="stamp">${esc(stamp)}</div>
      <div class="eyebrow">${esc(title)} · executive summary · ${esc(day(win.since))} → ${esc(day(win.until))}</div>
      <div class="byline">${esc(byline)}</div>
    </header>

    <div class="lede">
      <h1>${esc(stripTags(draft.headline))}</h1>
      <div class="standfirst">
${standfirstHtml}
      </div>
    </div>
${heroHtml}
${sectionsHtml}
${appendixHtml}

    <footer class="colophon">
      <span>every claim above resolves to a listed receipt</span>
      <span>${esc(day(win.since))} → ${esc(day(win.until))}</span>
    </footer>
  </main>
</body>
</html>
`;
}
