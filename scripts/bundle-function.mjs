// Bundles the runtime-agnostic server into a single ESM file for the Supabase Edge Function.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
mkdirSync('supabase/functions/api/bundle', { recursive: true });
await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  outfile: 'supabase/functions/api/bundle/server.js',
  external: ['@supabase/supabase-js', 'postgres', 'node:*'],
  alias: { '@allin/engine': './engine/src/index.ts' },
  legalComments: 'none', minify: true, sourcemap: false, lineLimit: 400,
  define: { 'process.env.NODE_ENV': '"production"' },
});
let out = readFileSync('supabase/functions/api/bundle/server.js', 'utf8');
out = out.replace(/from ?"@supabase\/supabase-js"/g, 'from"npm:@supabase/supabase-js@2.118.0"');
if (/postgres"/.test(out)) throw new Error('postgres driver must not be bundled into the edge function');
writeFileSync('supabase/functions/api/bundle/server.js', out);
console.log('bundled', out.length, 'bytes');
