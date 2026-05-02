import { useState } from 'react';
import DevLogPage from '../examples/react/DevLogPage.jsx';
import { DEMO_BASE, DEMO_PROJECTS, DEMO_PROJECT_KEY } from './demo.js';

const owner = import.meta.env.VITE_DEVLOG_OWNER;
const repo = import.meta.env.VITE_DEVLOG_REPO;
const branch = import.meta.env.VITE_DEVLOG_BRANCH || 'main';
const projectsRaw = import.meta.env.VITE_DEVLOG_PROJECTS;
const isDev = import.meta.env.DEV;

const isDemo = !owner || !repo;

let realProjects = [];
try {
  const parsed = projectsRaw ? JSON.parse(projectsRaw) : [];
  // Schema-validate: must be array of {key, label?} where key matches a safe
  // allowlist. Anything else gets dropped silently.
  if (Array.isArray(parsed)) {
    for (const p of parsed) {
      if (!p || typeof p !== 'object') continue;
      if (typeof p.key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p.key)) continue;
      if (p.key.includes('..')) continue;
      const label = typeof p.label === 'string' ? p.label : p.key;
      realProjects.push({ key: p.key, label });
    }
  }
} catch {
  realProjects = [];
}

const config = isDemo
  ? { repoOwner: 'demo', repoName: 'demo', branch: 'main', baseUrl: DEMO_BASE }
  : { repoOwner: owner, repoName: repo, branch };

const projects = isDemo
  ? DEMO_PROJECTS
  : (realProjects.length > 0 ? realProjects : null);

function DemoBanner() {
  return (
    <div className="demo-banner" role="alert">
      <div className="demo-banner__row">
        <strong>👋 demo mode</strong>
        <span>
          You're looking at fake entries. Wipe this and point at your real dev log:
        </span>
      </div>
      <pre className="demo-banner__code">npx @natjswenson/devlog init</pre>
      <div className="demo-banner__small">
        Or set <code>VITE_DEVLOG_OWNER</code>, <code>VITE_DEVLOG_REPO</code>, <code>VITE_DEVLOG_PROJECTS</code> in <code>preview/.env.local</code> and restart vite.
      </div>
    </div>
  );
}

function NoProjectsScreen() {
  return (
    <div className="empty-screen">
      <h1>You found the preview, congratulations.</h1>
      <p>
        Env vars say you have a repo (<code>{owner}/{repo}</code>) but no projects.
        That's like buying a stage and forgetting to invite a band.
      </p>
      <p>Add a project the easy way:</p>
      <pre>npx @natjswenson/devlog add-project</pre>
      <p>Or edit your config directly:</p>
      <pre>{`{
  "targetRepo": "${owner}/${repo}",
  "branch": "${branch}",
  "projects": [
    { "key": "myproject", "label": "My Project", "path": "...", "remote": "${owner}/myproject" }
  ]
}`}</pre>
      <p>Then re-run <code>npx @natjswenson/devlog preview</code>.</p>
    </div>
  );
}

// Production builds without env vars: show a clear "setup required" screen,
// not the demo banner with broken fetches (since installDemoFetch is gated to DEV).
function SetupRequiredScreen() {
  return (
    <div className="empty-screen">
      <h1>Setup required</h1>
      <p>
        This preview was built without the env vars that point it at a dev-log repo.
        Set these in your hosting environment (Vercel/Netlify/Cloudflare/wherever):
      </p>
      <pre>{`VITE_DEVLOG_OWNER=your-github-username
VITE_DEVLOG_REPO=daily-dev-log
VITE_DEVLOG_BRANCH=main
VITE_DEVLOG_PROJECTS=[{"key":"myproject","label":"My Project"}]`}</pre>
      <p>
        Or, if you're trying this locally, the friendlier path is:
      </p>
      <pre>npx @natjswenson/devlog init &amp;&amp; npx @natjswenson/devlog preview</pre>
    </div>
  );
}

export default function App() {
  const [activeKey, setActiveKey] = useState((projects && projects[0]?.key) || DEMO_PROJECT_KEY);

  // Production build with no env vars: show actionable setup screen
  // (demo fetch override is DEV-only, so demo entries would 404 here).
  if (isDemo && !isDev) {
    return <SetupRequiredScreen />;
  }

  if (!isDemo && !projects) {
    return <NoProjectsScreen />;
  }

  return (
    <>
      {isDemo && <DemoBanner />}
      <DevLogPage
        project={activeKey}
        projects={projects}
        config={config}
        onProjectChange={setActiveKey}
      />
    </>
  );
}
