import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDevLogEntries } from './useDevLogEntries.js';
import { DEVLOG_PROJECTS } from './devlog-config.js';
import './DevLogPage.css';

const ENTRIES_PER_PAGE = 10;

function formatDate(dateStr) {
  if (typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '';
  const [year, month, day] = parts;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * DevLogPage renders the entries from a single project of your daily-dev-log repo.
 *
 * Props:
 *   project          (string)   active project key (must match a folder in your dev-log repo)
 *   projects         (Project[]) optional — list of projects to render as tabs.
 *                                Defaults to DEVLOG_PROJECTS from devlog-config.js.
 *                                Hidden if length <= 1.
 *   onProjectChange  (function) called with key when a tab is clicked.
 *                                Wire this to your router (e.g. navigate(`/devlog/${key}`)).
 *   config           (object)   optional config override { repoOwner, repoName, branch }.
 *                                Used by the preview app; adopters should set values in
 *                                devlog-config.js instead.
 */
export default function DevLogPage({
  project,
  projects = DEVLOG_PROJECTS,
  onProjectChange,
  config,
}) {
  const activeProject = project || projects[0]?.key;
  const { entries, loadedContent, loading, error, fetchEntryContent, retry } = useDevLogEntries(activeProject, config);
  const [expandedEntry, setExpandedEntry] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ENTRIES_PER_PAGE);

  useEffect(() => {
    setExpandedEntry(null);
    setVisibleCount(ENTRIES_PER_PAGE);
  }, [activeProject]);

  const handleToggle = useCallback((filename) => {
    if (expandedEntry === filename) {
      setExpandedEntry(null);
    } else {
      setExpandedEntry(filename);
      if (!loadedContent.has(filename)) {
        fetchEntryContent(filename);
      }
    }
  }, [expandedEntry, loadedContent, fetchEntryContent]);

  const visibleEntries = entries.slice(0, visibleCount);
  const hasMore = visibleCount < entries.length;
  const showTabs = projects && projects.length > 1;

  return (
    <div className="devlog-page">
      {showTabs && (
        <div className="devlog-tabs">
          {projects.map((p) => (
            <button
              key={p.key}
              className={`devlog-tab${p.key === activeProject ? ' devlog-tab--active' : ''}`}
              onClick={() => onProjectChange?.(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="devlog-list" aria-busy="true" aria-label="Loading entries">
          {[0, 1, 2].map((i) => (
            <div key={i} className="devlog-skeleton">
              <div className="devlog-skeleton__line devlog-skeleton__line--date" />
              <div className="devlog-skeleton__line devlog-skeleton__line--title" />
              <div className="devlog-skeleton__line devlog-skeleton__line--summary" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="devlog-error">
          <p className="devlog-error__text">Failed to load entries: {error}</p>
          <button className="devlog-btn" onClick={retry}>Retry</button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="devlog-empty">
          <p className="devlog-empty__text">No entries yet.</p>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <>
          <div className="devlog-list">
            {visibleEntries.map((entry) => {
              const isExpanded = expandedEntry === entry.file;
              const content = loadedContent.get(entry.file);

              return (
                <article
                  key={entry.file}
                  className={`devlog-entry${isExpanded ? ' devlog-entry--expanded' : ''}`}
                  onClick={() => handleToggle(entry.file)}
                >
                  <div className="devlog-header">
                    <div className="devlog-header__left">
                      <p className="devlog-date">{formatDate(entry.date)}</p>
                      <h2 className="devlog-title">{entry.title}</h2>
                      <p className="devlog-summary">{entry.summary}</p>
                    </div>
                    <div className="devlog-chevron" aria-hidden="true">
                      <ChevronDown />
                    </div>
                  </div>

                  <div className="devlog-content-wrapper">
                    <div className="devlog-content-inner">
                      {isExpanded && content && (
                        <div className="devlog-content" onClick={(e) => e.stopPropagation()}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content}
                          </ReactMarkdown>
                        </div>
                      )}
                      {isExpanded && !content && (
                        <div className="devlog-content">
                          <p className="devlog-empty__text">Loading...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {hasMore && (
            <div className="devlog-load-more">
              <button className="devlog-btn" onClick={() => setVisibleCount((c) => c + ENTRIES_PER_PAGE)}>
                Load More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
