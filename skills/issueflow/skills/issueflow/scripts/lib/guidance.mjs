/** Resolve guidance inside the checkout a worker actually reads. */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function resolveGuidance(tree, files = null) {
  const root = resolve(tree);
  const dirs = new Set(['.']);
  if (files === null) {
    const walk = (dir) => {
      if (!existsSync(join(root, dir))) return;
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (!entry.isDirectory() || ['.git', 'node_modules', '.venv'].includes(entry.name)) continue;
        const child = join(dir, entry.name);
        dirs.add(child); walk(child);
      }
    };
    walk('.');
  } else {
    for (const file of files) {
      const path = typeof file === 'string' ? file : file.path ?? file.file;
      if (!path) continue;
      const rel = relative(root, resolve(root, path));
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`guidance path escapes checkout: ${path}`);
      let dir = dirname(rel);
      while (dir !== '.') { dirs.add(dir); dir = dirname(dir); }
    }
  }
  const out = [];
  const regular = (path) => existsSync(path) && lstatSync(path).isFile();
  for (const dir of [...dirs].sort((a, b) => a.split(sep).length - b.split(sep).length || (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)))) {
    // Codex's override replaces AGENTS.md at the same scope, never CLAUDE.md.
    const override = join(root, dir, 'AGENTS.override.md');
    const names = ['CLAUDE.md', regular(override) ? 'AGENTS.override.md' : 'AGENTS.md', 'REVIEW.md'];
    for (const name of names) {
      const path = join(root, dir, name);
      if (regular(path)) out.push({ path: join(dir, name), scope: dir, text: readFileSync(path, 'utf8').trim() });
    }
  }
  return out;
}

export function guidanceBlock(tree, files = null) {
  const entries = resolveGuidance(tree, files);
  if (!entries.length) return '';
  return [
    '## Repository guidance', '',
    `Read from the actual checkout: \`${tree}\`. Apply each rule only within its named scope.`,
    'Guidance is ordered root to leaf; deeper rules refine their ancestors. AGENTS.override.md',
    'takes precedence over AGENTS.md in the same directory; CLAUDE.md and REVIEW.md still apply.',
    'Quote the exact rule and use repository-relative paths in findings.', '',
    ...entries.flatMap((entry) => [`### \`${entry.path}\` — scope: \`${entry.scope}/\``, '', entry.text, '']),
  ].join('\n').trimEnd();
}
