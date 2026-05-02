import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installDemoFetch } from './demo.js';
import './preview.css';

if (!import.meta.env.VITE_DEVLOG_OWNER || !import.meta.env.VITE_DEVLOG_REPO) {
  installDemoFetch();
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
