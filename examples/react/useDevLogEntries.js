import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DEVLOG_CONFIG as DEFAULT_CONFIG } from './devlog-config.js';

/**
 * Parse YAML-ish frontmatter from a markdown string.
 * Returns { metadata: { title, date, project, summary }, body: string }
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: raw };

  const frontmatter = match[1];
  const body = match[2];
  const metadata = {};

  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*"?([^"]*)"?\s*$/);
    if (m) metadata[m[1]] = m[2].trim();
  }

  return { metadata, body };
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
      const url = `${config.baseUrl}/${project}/manifest.json`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          setEntries([]);
          return;
        }
        throw new Error(`Failed to fetch manifest (${res.status})`);
      }
      const data = await res.json();
      setEntries(data.entries || []);
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

    try {
      const url = `${config.baseUrl}/${project}/${filename}`;
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
