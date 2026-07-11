/**
 * Hi! 👋 You're looking at the demo config.
 *
 * Step 1: replace `repoOwner` and `repoName` with YOUR daily-dev-log repo.
 * Step 2: replace the placeholder projects with your actual ones.
 * Step 3: feel a small wave of accomplishment, then ship something.
 *
 * (If you skip these steps, the page will silently render nothing,
 *  and you will be left to wonder why. Don't do that to yourself.)
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
  { key: 'midnight-side-quest', label: 'Midnight Side Quest' },
  { key: 'todays-existential-crisis', label: "Today's Existential Crisis" },
];
