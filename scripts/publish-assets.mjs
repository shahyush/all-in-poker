// Publishes a built directory into public.app_assets through the `code` edge function's upload endpoint.
// usage: node scripts/publish-assets.mjs <dir> <prefix web|edge> [--prune]
//   env: SUPABASE_URL, ALLIN_UPLOAD_TOKEN (one-time token whose sha256 is stored in app_settings.upload_token_sha)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

const [dir, prefix, ...flags] = process.argv.slice(2);
if (!dir || !['web', 'edge'].includes(prefix)) { console.error('usage: publish-assets.mjs <dir> <web|edge> [--prune]'); process.exit(2); }
const base = process.env.SUPABASE_URL, token = process.env.ALLIN_UPLOAD_TOKEN;
if (!base || !token) { console.error('SUPABASE_URL and ALLIN_UPLOAD_TOKEN are required'); process.exit(2); }
const TEXT = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.txt', '.svg', '.map']);

function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const files = walk(dir).map((p) => {
  const bytes = readFileSync(p);
  const text = TEXT.has(extname(p));
  return { path: `${prefix}/${relative(dir, p).split('\\').join('/')}`, body: text ? bytes.toString('utf8') : bytes.toString('base64'), encoding: text ? 'utf8' : 'base64', sha256: createHash('sha256').update(bytes).digest('hex') };
});
const batches = [];
for (let i = 0; i < files.length; i += 16) batches.push(files.slice(i, i + 16));
const written = [];
for (const [i, batch] of batches.entries()) {
  const last = i === batches.length - 1;
  const res = await fetch(`${base}/functions/v1/code/upload`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-allin-upload': token }, body: JSON.stringify({ files: last && flags.includes('--prune') ? [...files] : batch, prune: last && flags.includes('--prune') ? prefix : undefined }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) { console.error('upload failed', res.status, body); process.exit(1); }
  written.push(...body.written);
}
console.log('published', new Set(written).size, 'files:'); for (const f of files) console.log(' ', f.sha256.slice(0, 12), f.path);
