import { useState } from 'react';
import DevLogPage from '../examples/react/DevLogPage.jsx';
import { DEMO_BASE, DEMO_PROJECTS, DEMO_PROJECT_KEY } from './demo.js';

const owner = import.meta.env.VITE_DEVLOG_OWNER;
const repo = import.meta.env.VITE_DEVLOG_REPO;
const branch = import.meta.env.VITE_DEVLOG_BRANCH || 'main';
const projectsRaw = import.meta.env.VITE_DEVLOG_PROJECTS;

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
      <p>Add at least one project to your config:</p>
      <pre>{`{
  "projects": [
    { "key": "myproject", "path": "...", "remote": "${owner}/myproject" }
  ]
}`}</pre>
      <p>
        Then run <code>npx @natjswenson/devlog preview</code> again, or set
        <code> VITE_DEVLOG_PROJECTS</code> directly in <code>preview/.env.local</code>.
      </p>
    </div>
  );
}

export default function App() {
  const [activeKey, setActiveKey] = useState((projects && projects[0]?.key) || DEMO_PROJECT_KEY);

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
