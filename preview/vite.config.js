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
  server: {
    port: 5173,
    open: true,
  },
});
