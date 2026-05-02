/**
 * Edit this file to point at YOUR daily-dev-log repo.
 *
 * Required: change `repoOwner` and `repoName`.
 * Optional: add more projects to DEVLOG_PROJECTS as you register them in
 *           ~/.claude/skills/devlog/config.json.
 */

export const DEVLOG_CONFIG = {
  repoOwner: 'yourusername',
  repoName: 'daily-dev-log',
  branch: 'main',
  get baseUrl() {
    return `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${this.branch}`;
  },
};

export const DEVLOG_PROJECTS = [
  { key: 'myproject', label: 'My Project' },
];
