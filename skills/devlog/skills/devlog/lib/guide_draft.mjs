// Additive, local-only guide preparation. Never executes article code or publishes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import sharp from 'sharp';
import { lintPost, parseFrontmatter } from './lint_post.mjs';

const START = '<!-- agent-handoff:start -->';
const END = '<!-- agent-handoff:end -->';
const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fail = (code, message, findings) => Object.assign(new Error(message), { code, ...(findings ? { findings } : {}) });

function handoff(markdown) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  if (markdown.split(START).length !== 2 || markdown.split(END).length !== 2) {
    add('guide-handoff-markers', 'Use exactly one agent-handoff:start and one agent-handoff:end marker.');
    return { findings, reference: markdown };
  }
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (end <= start) {
    add('guide-handoff-order', 'The handoff end marker must follow its start marker.');
    return { findings, reference: markdown };
  }
  const { body } = parseFrontmatter(markdown);
  if (!body.trimStart().startsWith(START)) add('guide-handoff-position', 'The handoff must be the first body content, before the introduction and Shipped.');
  const block = markdown.slice(start + START.length, end);
  const fences = [...block.replaceAll('\r\n', '\n').matchAll(/^```([^\n]*)$/gm)];
  const match = /^```text\r?\n([\s\S]*?)\r?\n```\s*$/m.exec(block);
  if (fences.length !== 2 || fences[0]?.[1] !== 'text' || fences[1]?.[1] !== '' || !match || !match[1].trim()) {
    add('guide-handoff-prompt', 'The handoff must contain exactly one nonempty fenced text prompt.');
  }
  return { findings, prompt: match?.[1], reference: markdown.slice(0, start) + markdown.slice(end + END.length) };
}

// Same result shape as lintPost. Structural checks do not prove semantic quality or review.
export function lintGuide(markdown, { voice = false } = {}) {
  const parsed = handoff(markdown);
  const findings = [...lintPost(parsed.reference.replaceAll('\r\n', '\n'), { voice }).findings, ...parsed.findings];
  return { ok: findings.length === 0, findings };
}

function brandCss(tokens) {
  const fields = { paper: tokens.colors?.paper, ink: tokens.colors?.ink, dim: tokens.colors?.dim, accent: tokens.colors?.accent, hair: tokens.derived?.hair ?? tokens.colors?.ink };
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !/^(#[a-f\d]{6}|rgba\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(?:0|1|0?\.\d+)\s*\))$/i.test(value)) throw fail('GUIDE_BRAND_INVALID', `Invalid PRESS color: ${name}`);
  }
  for (const name of ['display', 'mono', 'serif']) {
    const value = tokens.fonts?.[`${name}_stack`];
    if (typeof value !== 'string' || !value.trim() || !/^[a-z\d\s,'"-]+$/i.test(value)) throw fail('GUIDE_BRAND_INVALID', `Invalid PRESS font stack: ${name}`);
    fields[`font-${name}`] = value;
  }
  for (const name of ['stamp', 'name']) if (typeof tokens.identity?.[name] !== 'string' || !tokens.identity[name].trim()) throw fail('GUIDE_BRAND_INVALID', `Missing PRESS identity: ${name}`);
  return `:root{${Object.entries(fields).map(([key, value]) => `--${key}:${value}`).join(';')}}`;
}

export async function prepareGuidePreview({ articlePath, outDir, brandPath, coverPath } = {}) {
  for (const [name, value] of Object.entries({ articlePath, outDir, brandPath })) if (typeof value !== 'string' || !value.trim()) throw fail('GUIDE_ARGUMENT', `${name} is required.`);
  const markdown = await fs.readFile(articlePath, 'utf8');
  const lint = lintGuide(markdown);
  if (!lint.ok) throw fail('GUIDE_LINT', 'Guide failed structural lint.', lint.findings);
  const { prompt, reference } = handoff(markdown);
  const payload = `${prompt}\n\n<reference-guide>\n${reference.trim()}\n</reference-guide>\n`;
  const { data } = parseFrontmatter(markdown.replaceAll('\r\n', '\n'));
  const { body } = parseFrontmatter(reference);
  const brandRaw = await fs.readFile(brandPath, 'utf8');
  let tokens;
  try { tokens = JSON.parse(brandRaw); } catch { throw fail('GUIDE_BRAND_INVALID', 'PRESS brand file must contain JSON.'); }
  if (!tokens || typeof tokens !== 'object') throw fail('GUIDE_BRAND_INVALID', 'PRESS brand file must contain an object.');
  const css = brandCss(tokens);
  let cover;
  if (coverPath) {
    cover = await fs.readFile(coverPath);
    try {
      const decoder = sharp(cover, { limitInputPixels: 40_000_000 });
      const meta = await decoder.metadata();
      if (meta.format !== 'png' || meta.width !== 1600 || meta.height !== 900 || (meta.pages || 1) !== 1) throw new Error('Expected one 1600 × 900 PNG.');
      await decoder.raw().toBuffer();
    } catch (error) { throw fail('GUIDE_COVER_INVALID', `Cover must be a decodable, single-frame 1600 × 900 PNG: ${error.message}`); }
  }
  const styles = await fs.readFile(new URL('./guide_preview.css', import.meta.url), 'utf8');
  const rendered = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm], skipHtml: true,
    components: {
      // Validate resolved Markdown nodes, including reference-style links. This
      // draft helper copies one article, not an arbitrary companion directory.
      a({ node: _node, href, children, ...props }) {
        if (typeof href !== 'string' || !/^(https?:\/\/|#)/i.test(href)) throw fail('GUIDE_ASSET_UNSUPPORTED', 'Guide links must use public HTTP(S) URLs or same-page anchors. Relative companion files are not bundled; include required code inline.');
        return React.createElement('a', { ...props, href }, children);
      },
      img() { throw fail('GUIDE_ASSET_UNSUPPORTED', 'Embedded Markdown images are not bundled. Supply a local PNG with coverPath, or retain the draft until companion-asset support is available.'); },
    },
  }, body));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.title)}</title><style>${css}\n${styles}</style></head><body><main>
<header class="masthead"><div class="stamp">${escape(tokens.identity.stamp)}</div><div class="eyebrow">CONCEPT GUIDE · LOCAL DRAFT</div><div class="byline">${escape(tokens.identity.name)}</div></header>
<h1>${escape(data.title)}</h1><section class="agent-handoff" aria-labelledby="agent-heading"><h2 id="agent-heading">Implement this with your agent</h2><p>Copy the implementation prompt and complete guide, then paste into your coding agent in your project.</p><button type="button" id="copy-agent">Copy prompt + guide</button><p id="copy-status" role="status" aria-live="polite"></p><textarea id="copy-fallback" readonly hidden aria-label="Prompt and complete guide for manual copying"></textarea><details><summary>Read the prompt</summary><pre>${escape(prompt)}</pre></details><p><a href="agent-prompt.txt" download>Download prompt + complete guide</a></p><noscript><p>JavaScript is disabled. Open the <a href="agent-prompt.txt">complete plain-text handoff</a> and copy it into your agent.</p></noscript></section>
${cover ? `<figure><a href="cover.png"><img src="cover.png" width="1600" height="900" alt="Cover for ${escape(data.title)}"></a></figure>` : ''}
<p class="notice">Draft for review · <a href="article.md">Markdown guide</a> · Structural lint passed; implementation and independent review are separate checks.</p>${rendered}<footer class="colophon">Local draft. This helper does not publish.</footer></main>
<script type="application/json" id="agent-payload">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script>
<script>
const payload = JSON.parse(document.getElementById('agent-payload').textContent);
const button = document.getElementById('copy-agent');
const status = document.getElementById('copy-status');
const fallback = document.getElementById('copy-fallback');
button.addEventListener('click', async () => {
  status.textContent = '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(payload);
    fallback.hidden = true;
    status.textContent = 'Copied prompt and complete guide. Paste into your agent.';
  } catch {
    fallback.hidden = false; fallback.value = payload; fallback.focus(); fallback.select();
    status.textContent = 'Automatic copy is unavailable. The full text is selected below; press Cmd+C or Ctrl+C.';
  }
});
</script></body></html>`;
  const result = { schemaVersion: 1, status: 'local-draft', article: 'article.md', preview: 'index.html', agentPrompt: 'agent-prompt.txt', cover: cover ? 'cover.png' : null, articleSha256: hash(markdown), previewSha256: hash(html), stylesheetSha256: hash(styles), agentPromptSha256: hash(payload), brandSha256: hash(brandRaw), ...(cover ? { coverSha256: hash(cover) } : {}), lint, verification: { implementation: 'not-run', independentReview: 'not-run' } };
  // mkdir without recursive is the exclusive claim. Existing directories/symlinks fail;
  // a failed partial write retains no result.json completion marker and is never reused.
  await fs.mkdir(outDir);
  await fs.writeFile(path.join(outDir, 'article.md'), markdown, { flag: 'wx' });
  await fs.writeFile(path.join(outDir, 'index.html'), html, { flag: 'wx' });
  await fs.writeFile(path.join(outDir, 'agent-prompt.txt'), payload, { flag: 'wx' });
  if (cover) await fs.writeFile(path.join(outDir, 'cover.png'), cover, { flag: 'wx' });
  await fs.writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}
