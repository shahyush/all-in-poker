// Shared HTTP adapter for both API entries: translates a Request into the runtime-agnostic App call.
// deno-lint-ignore no-explicit-any
export function serve(ready: Promise<any>) {
  Deno.serve(async (req: Request) => {
    let app;
    try { app = await ready; } catch (e) {
      console.error('[allin boot]', (e as Error).message);
      return new Response(JSON.stringify({ ok: false, error: { code: 'boot_failed', message: 'The game server is restarting, please try again' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const u = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body: unknown = null;
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const r = await app.handle({ method: req.method, path: u.pathname, headers, body });
    return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(r.headers ?? {}) } });
  });
}
