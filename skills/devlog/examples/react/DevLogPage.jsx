import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDevLogEntries } from './useDevLogEntries.js';
import { DEVLOG_PROJECTS } from './devlog-config.js';
import './DevLogPage.css';

const ENTRIES_PER_PAGE = 10;

// Strict allowlist of URL schemes permitted in markdown links/images.
// react-markdown 9's default sanitizer already blocks `javascript:`,
// `vbscript:`, `file:`. We narrow further: only http/https/mailto.
// Anything else (data:, blob:, ftp:, custom schemes) is replaced with `#`.
const SAFE_URL_SCHEME = /^(https?:|mailto:|#|\/|\.\.?\/|[^:]*$)/i;
function safeUrlTransform(url) {
  if (typeof url !== 'string') return '#';
  if (SAFE_URL_SCHEME.test(url)) return url;
  return '#';
}

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

  // Enter/Space toggle the focused entry — keyboard parity with the click
  // handler. preventDefault on Space stops the page from scrolling.
  const handleKeyDown = useCallback((e, filename) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle(filename);
    }
  }, [handleToggle]);

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
              const contentId = `devlog-content-${entry.file}`;

              return (
                <article
                  key={entry.file}
                  className={`devlog-entry${isExpanded ? ' devlog-entry--expanded' : ''}`}
                >
                  {/* The header is the disclosure control: role=button +
                      aria-expanded/aria-controls give screen readers the
                      toggle semantics, and it's keyboard-focusable. Keeping
                      it separate from the content region (rather than wrapping
                      the whole card in onClick) means links inside an expanded
                      entry aren't trapped inside an interactive ancestor. */}
                  <div
                    className="devlog-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={contentId}
                    onClick={() => handleToggle(entry.file)}
                    onKeyDown={(e) => handleKeyDown(e, entry.file)}
                  >
                    <div className="devlog-header__left">
                      <p className="devlog-date">{formatDate(entry.date)}</p>
                      <h2 className="devlog-title">{entry.title}</h2>
                      <p className="devlog-summary">{entry.summary}</p>
                    </div>
                    <div className="devlog-chevron" aria-hidden="true">
                      <ChevronDown />
                    </div>
                  </div>

                  <div className="devlog-content-wrapper" id={contentId}>
                    <div className="devlog-content-inner">
                      {isExpanded && content && (
                        <div className="devlog-content">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            urlTransform={safeUrlTransform}
                            skipHtml
                          >
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
