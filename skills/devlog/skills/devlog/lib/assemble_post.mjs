// Mechanical extraction of a post's fenced code blocks, in order, so the
// SKILL.md Step 4 assemble-and-run check is a command instead of an honor
// system: the audit of the first six runs found "copy the blocks into a
// scratch dir and run them" was skipped whenever it was inconvenient, and two
// posts shipped claiming "real output" over code that could not run.
// `text` fences are expected OUTPUT, not code — they're listed but not written
// as runnable files.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './lint_post.mjs';

// Languages a post realistically fences; anything unknown falls back to .txt
// so the block is still on disk for the agent to run by hand.
const LANG_EXT = {
  javascript: 'js', js: 'js', mjs: 'mjs', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
  json: 'json', yaml: 'yml', yml: 'yml', toml: 'toml',
  html: 'html', css: 'css', svg: 'svg', xml: 'xml',
  sql: 'sql', ruby: 'rb', go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp',
  markdown: 'md', md: 'md', diff: 'diff', ini: 'ini', dockerfile: 'dockerfile', makefile: 'mk',
};

const OUTPUT_LANGS = new Set(['text', 'txt', 'console', 'output']);

// Ordered fenced blocks of a post body (frontmatter excluded):
// [{ index, lang, code, runnable }] — `runnable` is false for output-shaped
// fences (`text` and friends), which readers compare against, not execute.
export function assemblePost(content) {
  const { body } = parseFrontmatter(content);
  const blocks = [];
  let current = null;
  for (const line of body.split('\n')) {
    const m = /^```(.*)$/.exec(line);
    if (m && !current) {
      current = { lang: m[1].trim().toLowerCase() || 'txt', lines: [] };
    } else if (m && current) {
      const lang = current.lang;
      blocks.push({
        index: blocks.length + 1,
        lang,
        code: current.lines.join('\n'),
        runnable: !OUTPUT_LANGS.has(lang),
      });
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

// Write the runnable blocks to outDir as NN.<ext> and return a manifest of
// everything (including the skipped output blocks) for the agent to execute
// in order.
export function writeAssembledBlocks(content, outDir) {
  const blocks = assemblePost(content);
  mkdirSync(outDir, { recursive: true });
  const written = blocks.map((b) => {
    if (!b.runnable) return { ...b, file: null };
    const ext = LANG_EXT[b.lang] || 'txt';
    const file = join(outDir, `${String(b.index).padStart(2, '0')}.${ext}`);
    writeFileSync(file, b.code.endsWith('\n') || b.code === '' ? b.code : `${b.code}\n`);
    return { index: b.index, lang: b.lang, runnable: true, file };
  });
  return {
    blocks: written.map(({ code, ...rest }) => rest),
    runnableCount: written.filter((b) => b.runnable).length,
    outputBlockCount: written.filter((b) => !b.runnable).length,
  };
}
