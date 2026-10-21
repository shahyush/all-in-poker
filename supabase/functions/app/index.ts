// The previous prototype host at /functions/v1/app is retired: send visitors to the new PWA.
const TARGET = Deno.env.get('ALLIN_APP_URL') ?? 'https://shahyush.github.io/all-in-poker/';
Deno.serve(() => new Response(null, { status: 302, headers: { Location: TARGET, 'Cache-Control': 'no-store' } }));
