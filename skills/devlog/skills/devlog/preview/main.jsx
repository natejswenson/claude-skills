import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installDemoFetch } from './demo.js';
import './preview.css';

// Gate the global window.fetch override behind DEV. In production builds
// (e.g. when adopters deploy the preview directory standalone), demo content
// must NOT silently intercept fetches — show the empty-state UX instead.
if (import.meta.env.DEV && (!import.meta.env.VITE_DEVLOG_OWNER || !import.meta.env.VITE_DEVLOG_REPO)) {
  installDemoFetch();
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
