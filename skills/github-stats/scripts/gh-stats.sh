#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# gh-stats.sh — deterministic GitHub profile statistics via the gh CLI.
#
# This is the skill's single source of truth for the numbers. All arithmetic
# (summing stars across paginated repos, counting commits, estimating close
# rates) happens here in jq/awk so the model never does math over raw JSON.
#
# Two layers:
#   * compute_* subcommands  — pure functions: read JSON on stdin, emit JSON.
#                              No network. These are what the tests exercise.
#   * live subcommands       — fetch with `gh api`, then pipe into compute_*.
#
# Metric definitions mirror the original github-stats-cli (github_stats/metrics).
#
# Usage:
#   gh-stats.sh overview   <username> [--json]
#   gh-stats.sh commits    <username> [--json]
#   gh-stats.sh followers  <username> [--json]
#   gh-stats.sh stars      <username> [--json]
#   gh-stats.sh prs        <username> [--json]
#   gh-stats.sh issues     <username> [--json]
#   gh-stats.sh repos      <username>            # repo browser (table)
#   gh-stats.sh repo       <username> <name>     # repo detail (table)
#
#   # pure compute helpers (stdin = JSON), used by tests:
#   gh-stats.sh compute_stars     < repos.json
#   gh-stats.sh compute_commits   < counts.json
#   gh-stats.sh compute_followers < user.json
#   gh-stats.sh compute_prs    <total> < sample.json
#   gh-stats.sh compute_issues <total> < sample.json
# ---------------------------------------------------------------------------
set -euo pipefail

COMMIT_PAGE_CAP=10   # 10 pages * 100 = 1000 commits/repo, matching the original's bound.

die() { printf 'error: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# --------------------------------------------------------------------------
# Pure compute functions (stdin JSON -> stdout JSON). No network.
# --------------------------------------------------------------------------

compute_stars() {
  # stdin: array of repo objects (need .name, .stargazers_count)
  # Mirrors StarMetric: only repos with stars > 0 count toward the total and
  # the "top" pick, so a user with no stars has a null top_repo (not repo[0]).
  jq -c '
    [.[] | select(.stargazers_count > 0)] as $starred
    | {
        total:     ($starred | map(.stargazers_count) | add // 0),
        top_repo:  (reduce $starred[] as $r (null;
                      if . == null or $r.stargazers_count > .stargazers_count then $r else . end)
                    | if . == null then null else .name end),
        top_count: ($starred | map(.stargazers_count) | max // 0)
      }'
}

compute_commits() {
  # stdin: array of {name, count}
  # First-max tie-break (strictly-greater reduce) to match Python max(), which
  # returns the first maximal element in repo iteration order.
  jq -c '
    {
      total:     (map(.count) | add // 0),
      top_repo:  (reduce .[] as $r (null;
                    if . == null or $r.count > .count then $r else . end)
                  | if . == null then null else .name end),
      top_count: (map(.count) | max // 0)
    }'
}

compute_followers() {
  # stdin: a user object
  jq -c '{followers: (.followers // 0), following: (.following // 0)}'
}

compute_prs() {
  # arg1: total_count ; stdin: array of sampled PR items (need .state)
  # Mirrors PullRequestMetric: open = raw count of open in the <=100 sample,
  # pct_closed = floor((total - open) / total * 100).
  local total="$1"
  jq -c --argjson total "$total" '
    ([.[] | select(.state == "open")] | length) as $open
    | {
        total: $total,
        pct_closed: (if $total > 0 then ((($total - $open) / $total) * 100 | floor) else 0 end)
      }'
}

compute_issues() {
  # arg1: total_count ; stdin: array of sampled issue items (need .state)
  # Mirrors IssueMetric: scale the sample's open ratio to the total.
  local total="$1"
  jq -c --argjson total "$total" '
    length as $n
    | ([.[] | select(.state == "open")] | length) as $open
    | (if $n > 0 then ($open / $n) else 0 end) as $ratio
    | (if $total > 0 then ($total * $ratio | floor) else 0 end) as $open_est
    | ($total - $open_est) as $closed
    | {
        total: $total,
        pct_closed: (if $total > 0 then (($closed / $total) * 100 | floor) else 0 end)
      }'
}

# --------------------------------------------------------------------------
# Live fetch helpers (require gh auth).
# --------------------------------------------------------------------------

fetch_repos() {
  # All owned repos across pages, flattened into one JSON array.
  gh api --paginate "users/$1/repos?per_page=100&type=owner" | jq -s 'add // []'
}

fetch_user() {
  gh api "users/$1"
}

count_repo_commits() {
  # Commits authored by $user on $repo, bounded at COMMIT_PAGE_CAP*100.
  local user="$1" repo="$2" page=1 total=0 n
  while [ "$page" -le "$COMMIT_PAGE_CAP" ]; do
    n=$(gh api "repos/$user/$repo/commits?author=$user&per_page=100&page=$page" --jq 'length' 2>/dev/null || echo 0)
    [ -z "$n" ] && n=0
    total=$((total + n))
    [ "$n" -lt 100 ] && break
    page=$((page + 1))
  done
  printf '%s' "$total"
}

search_total() {
  # total_count for a search/issues query.
  gh api "search/issues?q=$1&per_page=1" --jq '.total_count'
}

search_sample() {
  # up to 100 items for a search/issues query, as a JSON array.
  gh api "search/issues?q=$1&per_page=100" --jq '.items'
}

# --------------------------------------------------------------------------
# Metric collectors -> emit one JSON object each.
# --------------------------------------------------------------------------

collect_followers() { fetch_user "$1" | compute_followers; }

collect_stars() { fetch_repos "$1" | compute_stars; }

collect_prs() {
  local u="$1" total
  total=$(search_total "type:pr+author:$u")
  search_sample "type:pr+author:$u" | compute_prs "$total"
}

collect_issues() {
  local u="$1" total
  total=$(search_total "type:issue+author:$u")
  search_sample "type:issue+author:$u" | compute_issues "$total"
}

collect_commits() {
  local u="$1" repos names counts="[]"
  repos=$(fetch_repos "$u")
  names=$(printf '%s' "$repos" | jq -r '.[].name')
  if [ -n "$names" ]; then
    while IFS= read -r repo; do
      [ -z "$repo" ] && continue
      c=$(count_repo_commits "$u" "$repo")
      counts=$(printf '%s' "$counts" | jq -c --arg n "$repo" --argjson c "$c" '. + [{name:$n, count:$c}]')
    done <<< "$names"
  fi
  printf '%s' "$counts" | compute_commits
}

collect_overview() {
  local u="$1"
  jq -nc \
    --argjson commits   "$(collect_commits "$u")" \
    --argjson followers "$(collect_followers "$u")" \
    --argjson stars     "$(collect_stars "$u")" \
    --argjson prs       "$(collect_prs "$u")" \
    --argjson issues    "$(collect_issues "$u")" \
    --arg     username  "$u" \
    '{username:$username, commits:$commits, followers:$followers, stars:$stars, prs:$prs, issues:$issues}'
}

# --------------------------------------------------------------------------
# Rendering (JSON -> human table). Mirrors the original summary table.
# --------------------------------------------------------------------------

fmt() { printf "%'d" "$1" 2>/dev/null || printf '%s' "$1"; }

render_overview() {
  # stdin: overview JSON
  local j; j=$(cat)
  local user; user=$(printf '%s' "$j" | jq -r '.username')

  local c_total c_top c_topn f_followers f_following s_total s_top s_topn p_total p_pct i_total i_pct
  c_total=$(printf '%s' "$j" | jq -r '.commits.total')
  c_top=$(printf '%s' "$j" | jq -r '.commits.top_repo // "—"')
  c_topn=$(printf '%s' "$j" | jq -r '.commits.top_count')
  f_followers=$(printf '%s' "$j" | jq -r '.followers.followers')
  f_following=$(printf '%s' "$j" | jq -r '.followers.following')
  s_total=$(printf '%s' "$j" | jq -r '.stars.total')
  s_top=$(printf '%s' "$j" | jq -r '.stars.top_repo // "—"')
  s_topn=$(printf '%s' "$j" | jq -r '.stars.top_count')
  p_total=$(printf '%s' "$j" | jq -r '.prs.total')
  p_pct=$(printf '%s' "$j" | jq -r '.prs.pct_closed')
  i_total=$(printf '%s' "$j" | jq -r '.issues.total')
  i_pct=$(printf '%s' "$j" | jq -r '.issues.pct_closed')

  printf '\nGitHub Stats for: %s\n\n' "$user"
  printf '%-14s %8s   %s\n' "Metric" "Value" "Details"
  printf '%-14s %8s   %s\n' "──────────────" "────────" "──────────────────────────────"
  printf '%-14s %8s   Most: %s (%s)\n'   "Commits"       "$(fmt "$c_total")" "$c_top" "$(fmt "$c_topn")"
  printf '%-14s %8s   Following: %s\n'   "Followers"     "$(fmt "$f_followers")" "$(fmt "$f_following")"
  printf '%-14s %8s   Top: %s (%s)\n'    "Stars"         "$(fmt "$s_total")" "$s_top" "$(fmt "$s_topn")"
  printf '%-14s %8s   %s%% closed\n'     "Pull Requests" "$(fmt "$p_total")" "$p_pct"
  printf '%-14s %8s   %s%% closed\n'     "Issues"        "$(fmt "$i_total")" "$i_pct"
  printf '\n'
}

# --------------------------------------------------------------------------
# Repo browser / detail (full-parity, table only).
# --------------------------------------------------------------------------

cmd_repos() {
  local u="$1"
  printf '\nRepositories for %s (top 20 by stars)\n\n' "$u"
  printf '%-30s %7s %7s  %-12s %s\n' "Repository" "Stars" "Forks" "Language" "Description"
  fetch_repos "$u" \
    | jq -r 'sort_by(-.stargazers_count) | .[:20][]
             | [.name, (.stargazers_count|tostring), (.forks_count|tostring),
                (.language // "-"), ((.description // "") | .[0:40])] | @tsv' \
    | while IFS=$'\t' read -r name stars forks lang desc; do
        printf '%-30s %7s %7s  %-12s %s\n' "$name" "$stars" "$forks" "$lang" "$desc"
      done
  printf '\n'
}

cmd_repo() {
  local u="$1" name="$2" j
  j=$(gh api "repos/$u/$name") || die "repository '$u/$name' not found"
  printf '\nRepository: %s\n\n' "$(printf '%s' "$j" | jq -r '.full_name')"
  printf '%s' "$j" | jq -r '
    "  Description : \(.description // "(none)")",
    "  URL         : \(.html_url)",
    "  Language    : \(.language // "—")",
    "  Stars       : \(.stargazers_count)",
    "  Forks       : \(.forks_count)",
    "  Watchers    : \(.watchers_count)",
    "  Open Issues : \(.open_issues_count)",
    "  Created     : \(.created_at[0:10])",
    "  Updated     : \(.updated_at[0:10])",
    "  Visibility  : \(if .private then "Private" else "Public" end)"'
  printf '\n  Languages:\n'
  gh api "repos/$u/$name/languages" | jq -r '
    (to_entries | map(.value) | add) as $t
    | to_entries | sort_by(-.value) | .[:5][]
    | "    \(.key): \((.value / $t * 100) | floor)%"' 2>/dev/null || true
  printf '\n  Recent commits:\n'
  gh api "repos/$u/$name/commits?per_page=5" | jq -r '
    .[] | "    \(.commit.author.date[0:10])  \(.commit.author.name)  \(.commit.message | split("\n")[0] | .[0:50])"' 2>/dev/null || true
  printf '\n'
}

# --------------------------------------------------------------------------
# Dispatch.
# --------------------------------------------------------------------------

emit() {
  # emit <json> ; honour the trailing --json flag captured in WANT_JSON.
  if [ "${WANT_JSON:-0}" = "1" ]; then
    printf '%s\n' "$1"
  else
    case "$2" in
      overview)  printf '%s' "$1" | render_overview ;;
      *)         printf '%s\n' "$1" | jq '.' ;;
    esac
  fi
}

main() {
  need jq
  local cmd="${1:-}"; shift || true

  # pure compute subcommands need no gh and no flag parsing
  case "$cmd" in
    compute_stars|compute_commits|compute_followers) "$cmd"; return ;;
    compute_prs|compute_issues)    "$cmd" "${1:?total required}"; return ;;
  esac

  # strip a trailing --json flag for live commands
  WANT_JSON=0
  local args=()
  for a in "$@"; do
    if [ "$a" = "--json" ]; then WANT_JSON=1; else args+=("$a"); fi
  done
  set -- "${args[@]:-}"

  need gh
  case "$cmd" in
    overview)  [ -n "${1:-}" ] || die "usage: gh-stats.sh overview <username>";  emit "$(collect_overview "$1")"  overview ;;
    commits)   [ -n "${1:-}" ] || die "usage: gh-stats.sh commits <username>";   emit "$(collect_commits "$1")"   commits ;;
    followers) [ -n "${1:-}" ] || die "usage: gh-stats.sh followers <username>"; emit "$(collect_followers "$1")" followers ;;
    stars)     [ -n "${1:-}" ] || die "usage: gh-stats.sh stars <username>";     emit "$(collect_stars "$1")"     stars ;;
    prs)       [ -n "${1:-}" ] || die "usage: gh-stats.sh prs <username>";       emit "$(collect_prs "$1")"       prs ;;
    issues)    [ -n "${1:-}" ] || die "usage: gh-stats.sh issues <username>";    emit "$(collect_issues "$1")"    issues ;;
    repos)     [ -n "${1:-}" ] || die "usage: gh-stats.sh repos <username>";     cmd_repos "$1" ;;
    repo)      [ -n "${2:-}" ] || die "usage: gh-stats.sh repo <username> <name>"; cmd_repo "$1" "$2" ;;
    ""|-h|--help|help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "unknown command: $cmd (try --help)" ;;
  esac
}

main "$@"
