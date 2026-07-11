import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DEVLOG_CONFIG as DEFAULT_CONFIG } from './devlog-config.js';

// Allowlist of frontmatter keys we recognize. Anything else is ignored —
// prevents prototype-pollution via crafted keys like `__proto__`.
// `version` is the release tag this entry corresponds to (e.g. "v0.2.0").
const FRONTMATTER_KEYS = new Set(['title', 'date', 'project', 'summary', 'version']);

/**
 * Parse YAML-ish frontmatter from a markdown string.
 * Returns { metadata: { title, date, project, summary, version }, body: string }
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  // Use Object.create(null) so the returned object has no prototype chain.
  const metadata = Object.create(null);
  if (!match) return { metadata, body: raw };

  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*"?([^"]*)"?\s*$/);
    if (m && FRONTMATTER_KEYS.has(m[1])) metadata[m[1]] = m[2].trim();
  }

  return { metadata, body: match[2] };
}

// Schema validation for fetched manifest. Reject anything that isn't shaped
// like { entries: [{ date, file, title, summary, version? }, ...] } so a hostile
// commit to the dev-log repo can't crash the page. `version` is optional and
// only kept when it's a clean tag-ish string.
function validateManifest(data) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.entries)) return null;
  const entries = [];
  for (const e of data.entries) {
    if (!e || typeof e !== 'object') continue;
    const { date, file, title, summary, version } = e;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof file !== 'string' || !/^[a-zA-Z0-9._-]+\.md$/.test(file)) continue;
    if (typeof title !== 'string' || typeof summary !== 'string') continue;
    const entry = { date, file, title, summary };
    if (typeof version === 'string' && /^[a-zA-Z0-9._-]+$/.test(version)) entry.version = version;
    entries.push(entry);
  }
  return { entries };
}

/**
 * Hook for fetching dev log entries from a daily-dev-log repo on GitHub.
 *
 * Defaults to DEVLOG_CONFIG from ./devlog-config.js — pass `configOverride`
 * to inject runtime values (used by the preview app, generally not needed).
 *
 * @param {string} project - Project folder name (e.g. "myproject")
 * @param {object} [configOverride] - { repoOwner, repoName, branch, baseUrl? }
 * @returns {{ entries, loadedContent, loading, error, fetchEntryContent, retry }}
 */
export function useDevLogEntries(project, configOverride) {
  const config = useMemo(() => {
    const merged = { ...DEFAULT_CONFIG, ...(configOverride || {}) };
    if (!configOverride?.baseUrl) {
      merged.baseUrl = `https://raw.githubusercontent.com/${merged.repoOwner}/${merged.repoName}/${merged.branch}`;
    }
    return merged;
  }, [configOverride]);

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const contentCache = useRef(new Map());
  const [loadedContent, setLoadedContent] = useState(new Map());

  const fetchManifest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Encode project key to neutralize any path-traversal characters
      // (the project key is allowlisted upstream, but defense-in-depth).
      const url = `${config.baseUrl}/${encodeURIComponent(project)}/manifest.json`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          setEntries([]);
          return;
        }
        throw new Error(`Failed to fetch manifest (${res.status})`);
      }
      const data = await res.json();
      const validated = validateManifest(data);
      if (!validated) throw new Error('Manifest failed schema validation');
      setEntries(validated.entries);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [project, config]);

  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  const fetchEntryContent = useCallback(async (filename) => {
    if (contentCache.current.has(filename)) return;

    // Final filename gate (manifest validation already enforces the same
    // pattern — keep this here so any consumer calling fetchEntryContent
    // directly is also protected).
    if (typeof filename !== 'string' || !/^[a-zA-Z0-9._-]+\.md$/.test(filename)) {
      return;
    }

    try {
      const url = `${config.baseUrl}/${encodeURIComponent(project)}/${filename}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch entry (${res.status})`);
      const raw = await res.text();
      const { body } = parseFrontmatter(raw);

      contentCache.current.set(filename, body);
      setLoadedContent(new Map(contentCache.current));
    } catch (err) {
      contentCache.current.set(filename, `*Error loading entry: ${err.message}*`);
      setLoadedContent(new Map(contentCache.current));
    }
  }, [project, config]);

  return { entries, loadedContent, loading, error, fetchEntryContent, retry: fetchManifest };
}
