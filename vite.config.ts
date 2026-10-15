import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from a GitHub Pages sub-path.
// Two pages: the app (index.html) and the technical notes (tech.html).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        tech: resolve(import.meta.dirname, 'tech.html'),
      },
    },
  },
});
