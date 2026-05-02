import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Force pre-bundling of these packages so Vite's CJS interop adds the
  // default-export shim. Without this, react-markdown's transitive
  // `style-to-js` (CJS-only) blows up with "does not provide an export
  // named 'default'" when imported by hast-util-to-jsx-runtime.
  optimizeDeps: {
    include: ['react-markdown', 'remark-gfm', 'style-to-js'],
  },
  server: {
    port: 5173,
    open: true,
  },
});
