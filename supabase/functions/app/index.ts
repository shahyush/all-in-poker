// The previous prototype host at /functions/v1/app is retired: send visitors to the PWA.
// (Edge Functions on the default supabase.co domain serve HTML as text/plain, so the app cannot be hosted here.)
const TARGET = Deno.env.get('ALLIN_APP_URL') ?? 'https://shahyush.github.io/all-in-poker/';
Deno.serve(() => new Response(null, { status: 302, headers: { Location: TARGET, 'Cache-Control': 'no-store' } }));
