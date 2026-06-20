/**
 * keyword-coverage — deterministic JD-noun echo proxy.
 *
 * Measures what fraction of the job description's significant terms appear in the
 * tailored résumé's LIVE rendered content (`resume.experience[].bullets` plus
 * `resume.summary`) — NOT the `optimizedBullets` diff record.
 *
 * This is a WEAK, gameable signal (a résumé that keyword-stuffs every JD noun
 * scores 100% while being no more qualified). It is the benchmark's only
 * function-deterministic signal that tracks fit to a *specific* JD, so the
 * discrimination check leans on it — but read it alongside faithfulness, never
 * alone. See the design doc's Metrics section.
 *
 * Determinism: pure function of (resume, jobText). Same inputs → same output.
 * (The résumé itself is LLM-tailored and varies run-to-run; that variance is
 * upstream of this function.)
 *
 * The caller passes the TRIMMED JD (`trimJobText` output, first 6000 chars) so
 * coverage scores against exactly the input the LLM saw — long postings aren't
 * penalized for keywords the model never received.
 */

// Common English + résumé/JD-boilerplate words that carry no fit signal. Kept
// deliberately small and explicit; over-stripping would make coverage arbitrary.
const STOPWORDS = new Set([
  // articles / conjunctions / prepositions / pronouns
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "that",
  "this", "from", "have", "has", "had", "not", "but", "all", "any", "can",
  "who", "what", "when", "where", "why", "how", "into", "out", "off", "per",
  "via", "etc", "their", "them", "they", "his", "her", "its", "ours", "his",
  "she", "him", "was", "were", "been", "being", "than", "then", "those",
  "these", "such", "each", "some", "more", "most", "other", "also", "may",
  "must", "should", "would", "could", "about", "across", "within", "while",
  "using", "use", "used", "able", "well", "both", "very", "much", "many",
  // generic JD boilerplate
  "experience", "experienced", "team", "teams", "work", "working", "role",
  "roles", "job", "company", "companies", "candidate", "candidates", "looking",
  "join", "help", "build", "building", "ensure", "ensuring", "support",
  "supporting", "drive", "driving", "deliver", "delivering", "responsible",
  "responsibilities", "requirements", "required", "qualifications", "preferred",
  "plus", "nice", "strong", "solid", "good", "great", "excellent", "ideal",
  "year", "years", "new", "best", "high", "level", "based", "including",
  "include", "includes", "across", "world", "people", "things", "stuff",
  "things", "day", "days", "today", "future", "remote", "hybrid", "onsite",
  "full", "time", "part", "position", "opportunity", "opportunities", "value",
  "values", "culture", "mission", "vision", "growth", "impact", "career",
]);

/**
 * Tokenize text into candidate terms. Keeps tech-shaped tokens intact:
 * "ci/cd", "node.js", "c++", "k8s" survive as single tokens. Lowercased,
 * deduped by the caller.
 */
function tokenize(text) {
  // A token is an alphanumeric run that may contain internal . / + # -
  // (so "ci/cd", "node.js", "c++", "github-actions" stay whole), trimmed of
  // leading/trailing separators.
  const raw = text.toLowerCase().match(/[a-z0-9][a-z0-9+#./-]*[a-z0-9]|[a-z0-9]/g) || [];
  return raw
    .map((t) => t.replace(/^[-./+#]+|[-./+#]+$/g, ""))
    .filter(Boolean);
}

/** Significant JD keywords: deduped tokens, length >= 3, not stopwords. */
function extractKeywords(jobText) {
  const seen = new Set();
  for (const tok of tokenize(jobText)) {
    if (tok.length < 3) continue; // drops 1-2 char noise; "aws"/"sre"/"iac" kept
    if (STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue; // bare numbers carry no fit signal
    seen.add(tok);
  }
  return [...seen];
}

/**
 * @param {object} resume - tailored ResumeJSON
 * @param {string} trimmedJobText - the trimJobText output (first 6000 chars)
 * @returns {{ coverage: number, matched: string[], missed: string[] }}
 *   coverage in [0,1]; matched/missed are sorted keyword lists.
 */
export function keywordCoverage(resume, trimmedJobText) {
  const keywords = extractKeywords(trimmedJobText || "");

  // Build the résumé's live content corpus, as a token SET for O(1) membership.
  const summary = resume?.summary ?? "";
  const bullets = (resume?.experience ?? []).flatMap((e) => e?.bullets ?? []);
  const corpus = new Set(tokenize([summary, ...bullets].join(" ")));

  const matched = [];
  const missed = [];
  for (const kw of keywords) {
    if (corpus.has(kw)) matched.push(kw);
    else missed.push(kw);
  }
  matched.sort();
  missed.sort();

  const coverage = keywords.length === 0 ? 0 : matched.length / keywords.length;
  return { coverage: +coverage.toFixed(4), matched, missed };
}
