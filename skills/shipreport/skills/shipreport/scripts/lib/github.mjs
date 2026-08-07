/**
 * GitHub contributions → items, via the `gh` CLI.
 *
 * This is the only networked code in the skill. Everything downstream reads the
 * cache instead, which is what lets the baseline eval re-run `rank` and `render`
 * offline and byte-compare them.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function gh(args, { allowFail = false } = {}) {
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (allowFail) return null;
    const detail = (err.stderr || err.message || '').trim().split('\n')[0];
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
}

const json = (s, fallback = []) => {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

/**
 * Bodies are cached so that "read what you are about to describe" costs nothing.
 *
 * Without them the corpus holds a release's tag, date and url but not a word of
 * what it says, so the only way to read one is `gh release view` per item — three
 * network round trips and sixteen kilobytes of changelog printed into the
 * conversation, which is what the first real run did.
 *
 * They are excerpted rather than stored whole: the corpus is read in full by
 * every later run, and a body is evidence for one paragraph, not an archive.
 */
export const RELEASE_BODY_MAX = 6000;
export const PR_BODY_MAX = 2000;

export const excerpt = (text, max) => {
  const s = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}\n… [${s.length - max} more characters not cached]`;
};

export async function whoami() {
  const out = await gh(['api', 'user', '--jq', '.login']);
  return out.trim();
}

const BOT = /\[bot\]$|^dependabot|^renovate/i;

/** The two search endpoints disagree on the field name for the same value. */
export const repoName = (r) => r?.nameWithOwner ?? r?.fullName ?? null;

export async function fetchPulls(login, since, limit = 300) {
  const out = await gh(['search', 'prs', '--author', login, '--merged-at', `>=${since}`,
    '--limit', String(limit), '--json', 'number,title,repository,closedAt,createdAt,url,labels,state,body']);
  return json(out).map((p) => ({
    id: `pr:${repoName(p.repository)}#${p.number}`,
    kind: 'pr',
    receipt: `pr:${repoName(p.repository)}#${p.number}`,
    number: p.number,
    repo: repoName(p.repository),
    title: p.title,
    body: excerpt(p.body, PR_BODY_MAX),
    url: p.url,
    at: p.closedAt || p.createdAt,
    labels: (p.labels ?? []).map((l) => l.name),
  }));
}

export async function fetchCommits(login, since, limit = 300) {
  const out = await gh(['search', 'commits', '--author', login, '--author-date', `>=${since}`,
    '--sort', 'author-date', '--order', 'desc',
    '--limit', String(limit), '--json', 'sha,commit,repository,url'], { allowFail: true });
  return json(out)
    .filter((c) => !BOT.test(c.commit?.author?.name ?? ''))
    .map((c) => {
      // `gh search commits` names it fullName; `gh search prs` names the same
      // thing nameWithOwner. Reading only one of them yields `undefined` in the
      // receipt id, which the squash fold then silently fails to match.
      const repo = repoName(c.repository);
      return {
        id: `commit:${repo}@${c.sha.slice(0, 7)}`,
        kind: 'commit',
        receipt: `commit:${repo}@${c.sha.slice(0, 7)}`,
        sha: c.sha,
        repo,
        title: (c.commit?.message ?? '').split('\n')[0],
        url: c.url,
        at: c.commit?.author?.date ?? null,
      };
    })
    .filter((c) => c.at && c.repo);
}

/**
 * Repos are fetched concurrently. Serially awaiting one `gh api` per repo made
 * the first-run year backfill scale with the number of repos touched, which is
 * the slowest thing this skill does and the only part of it that is pure waiting.
 */
export async function fetchReleases(repos, since) {
  const perRepo = await Promise.all(repos.map(async (repo) => {
    const out = await gh(['api', `repos/${repo}/releases?per_page=100`,
      '--jq', '.[] | {tag: .tag_name, name: .name, at: .published_at, url: .html_url, draft: .draft, body: .body}'],
    { allowFail: true });
    if (!out) return [];
    const items = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.draft || !r.at || r.at < since) continue;
      items.push({
        id: `release:${repo}@${r.tag}`,
        kind: 'release',
        receipt: `release:${repo}@${r.tag}`,
        tag: r.tag,
        repo,
        title: r.name || r.tag,
        body: excerpt(r.body, RELEASE_BODY_MAX),
        url: r.url,
        at: r.at,
      });
    }
    return items;
  }));
  // Flattened in the order `repos` was given, so a fetch is reproducible
  // regardless of which request happened to return first.
  return perRepo.flat();
}

/**
 * One call returns every GitHub item in the window. Releases are looked up only
 * in repos the user actually touched, so a year backfill does not walk every
 * repo the account can see.
 */
export async function fetchAll({ since, login = null }) {
  const who = login ?? await whoami();
  const [pulls, commits] = await Promise.all([
    fetchPulls(who, since),
    fetchCommits(who, since),
  ]);
  const repos = [...new Set([...pulls, ...commits].map((i) => i.repo))].sort();
  const releases = await fetchReleases(repos, since);
  return { login: who, items: [...pulls, ...commits, ...releases], repos };
}
