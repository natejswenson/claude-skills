import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Force pre-bundling so Vite's CJS interop adds the default/named-export
  // shims. Skipping any of these caused render failures in the npx-installed
  // layout (react-dom/client missing createRoot, react-markdown's transitive
  // style-to-js missing default, etc.).
  optimizeDeps: {
    include: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
      'react-dom/client',
      'react-markdown',
      'remark-gfm',
      'style-to-js',
    ],
  },
  // Bind preview server to localhost only — the dev server has no auth and
  // serves transformed source modules. Don't expose it to LAN by default.
  // (npm audit flags moderate CVEs in dev-server CORS handling for any
  // deployment that allows cross-origin reads; localhost-binding is
  // defense-in-depth on top of vite's own patches.)
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
    strictPort: false,
    cors: false,
  },
});
