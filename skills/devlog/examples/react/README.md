# React example — devlog

Drop-in React components for rendering your daily dev log on any React-based site.

## What's here

| File | What to do with it |
|---|---|
| `devlog-config.js` | **Edit this.** Set `repoOwner` and `repoName` to your dev-log repo. |
| `useDevLogEntries.js` | Hook that fetches the manifest + entry markdown. No edits needed. |
| `DevLogPage.jsx` | The page component. No edits needed. |
| `DevLogPage.css` | Self-contained styles with CSS variables you can override. |

## Install

1. Copy these four files into your React project (e.g. `src/devlog/`).
2. Install peer deps:
   ```sh
   npm install react-markdown remark-gfm
   ```
3. Edit `devlog-config.js` to point at your repo.
4. Mount the page somewhere in your app:

   ```jsx
   import DevLogPage from './devlog/DevLogPage.jsx';

   function MyDevLogRoute() {
     return <DevLogPage project="myproject" />;
   }
   ```

## With multiple projects + routing

```jsx
import { useNavigate, useParams } from 'react-router-dom';
import DevLogPage from './devlog/DevLogPage.jsx';

const PROJECTS = [
  { key: 'project-a', label: 'Project A' },
  { key: 'project-b', label: 'Project B' },
];

function DevLogRoute() {
  const { project = 'project-a' } = useParams();
  const navigate = useNavigate();
  return (
    <DevLogPage
      project={project}
      projects={PROJECTS}
      onProjectChange={(key) => navigate(`/devlog/${key}`)}
    />
  );
}
```

## Theming

Override the `--devlog-*` variables on `.devlog-page` (or any ancestor) in your own stylesheet:

```css
.devlog-page {
  --devlog-fg: #000;
  --devlog-bg-surface: #fafafa;
  /* ...etc */
}
```

Variables: `--devlog-fg`, `--devlog-fg-secondary`, `--devlog-fg-tertiary`, `--devlog-bg-surface`, `--devlog-bg-elevated`, `--devlog-border`, `--devlog-border-hover`.

A reasonable dark mode fires automatically via `prefers-color-scheme`.

## Want to use a non-React stack?

The hook and page are React-specific, but the underlying data is just static JSON + Markdown on GitHub. See the **Data contract** section of the top-level README.
