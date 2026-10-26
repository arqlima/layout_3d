import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    manifest: 'manifest.json',
    outDir: '../static/projects3d/viewer',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/entry.ts',
      output: {
        entryFileNames: 'viewer-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
