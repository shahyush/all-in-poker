import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Base path is the GitHub Pages project path by default; override with VITE_BASE for other hosts.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? (mode === 'production' ? '/all-in-poker/' : '/'),
  plugins: [react()],
  resolve: { alias: { '@allin/engine/public': fileURLToPath(new URL('../engine/src/public.ts', import.meta.url)) } },
  build: { sourcemap: false, target: 'es2020', outDir: 'dist', emptyOutDir: true, rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom'], supabase: ['@supabase/supabase-js'] } } } },
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
}));
