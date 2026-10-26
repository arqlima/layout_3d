import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '../static/projects3d/viewer',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/entry.ts',
      output: {
        entryFileNames: 'viewer.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
