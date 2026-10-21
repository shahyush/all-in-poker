import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

// Stamps the service worker with the build id and the hashed shell assets so each release gets its own cache.
function stampServiceWorker(base: string): Plugin {
  return {
    name: 'allin-stamp-sw',
    apply: 'build',
    closeBundle() {
      const build = process.env.VITE_BUILD_ID || process.env.COMMIT_REF || String(Date.now());
      const assets = readdirSync('dist/assets').map((f) => `${base}assets/${f}`);
      const shell = [...assets, `${base}manifest.webmanifest`, `${base}icons/icon-192.png`];
      let sw = readFileSync('dist/sw.js', 'utf8');
      sw = sw.replace("self.__ALLIN_BUILD || 'dev'", JSON.stringify(build.slice(0, 12))).replace('self.__ALLIN_ASSETS || []', JSON.stringify(shell));
      writeFileSync('dist/sw.js', sw);
    },
  };
}

// Base path is the GitHub Pages project path by default; override with VITE_BASE for other hosts.
export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE ?? (mode === 'production' ? '/all-in-poker/' : '/');
  return {
  base,
  plugins: [react(), stampServiceWorker(base)],
  resolve: { alias: { '@allin/engine/public': fileURLToPath(new URL('../engine/src/public.ts', import.meta.url)) } },
  build: { sourcemap: false, target: 'es2020', outDir: 'dist', emptyOutDir: true, rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/@supabase')) return 'supabase'; if (id.includes('node_modules/react')) return 'vendor'; return undefined; } } } },
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  };
});
