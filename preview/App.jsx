import { useState } from 'react';
import DevLogPage from '../examples/react/DevLogPage.jsx';

const owner = import.meta.env.VITE_DEVLOG_OWNER;
const repo = import.meta.env.VITE_DEVLOG_REPO;
const branch = import.meta.env.VITE_DEVLOG_BRANCH || 'main';
const projectsRaw = import.meta.env.VITE_DEVLOG_PROJECTS;

let projects = [];
try {
  projects = projectsRaw ? JSON.parse(projectsRaw) : [];
} catch {
  projects = [];
}

const config = owner && repo ? { repoOwner: owner, repoName: repo, branch } : null;

export default function App() {
  const [activeKey, setActiveKey] = useState(projects[0]?.key);

  if (!config) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h1>devlog preview</h1>
        <p>No config detected. Run this through the CLI:</p>
        <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 4 }}>
          npx @natejswenson/devlog preview
        </pre>
        <p>The CLI reads <code>~/.claude/skills/devlog/config.json</code> and passes it via env vars.</p>
        <p>If you haven't set up yet:</p>
        <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 4 }}>
          npx @natejswenson/devlog init
        </pre>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h1>devlog preview</h1>
        <p>Pointing at <code>github.com/{owner}/{repo}</code> but no projects are configured.</p>
        <p>Add projects to <code>~/.claude/skills/devlog/config.json</code>:</p>
        <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 4 }}>{`{
  "projects": [
    { "key": "myproject", "path": "...", "remote": "..." }
  ]
}`}</pre>
      </div>
    );
  }

  return (
    <DevLogPage
      project={activeKey}
      projects={projects}
      config={config}
      onProjectChange={setActiveKey}
    />
  );
}
