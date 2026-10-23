// Service-worker update coordination. A new build installs in the background, but the fresh service worker stays in
// "waiting" until every instance of the app is closed — on an installed PWA (especially iOS) that almost never happens,
// so the old shell can run for days after a deploy. We surface an unobtrusive in-app prompt instead, and never force a
// reload mid-hand: applying the update is the player's tap. We also poll for updates on focus and hourly so a long-lived
// PWA actually notices a new build.

// The build id stamped at build time (github.sha in CI); 'dev' for a local/unstamped build. Shown in the menu so the
// running build is verifiable against what was deployed.
export const BUILD_ID = ((import.meta.env.VITE_BUILD_ID as string | undefined) || 'dev').slice(0, 12);

let waiting: ServiceWorker | null = null;
let listener: (() => void) | null = null;
let reloading = false;

/** Register a callback fired when a new build is installed and ready to take over. Fires immediately if already waiting. */
export function onUpdateReady(cb: () => void): void { listener = cb; if (waiting) cb(); }

/** Apply the waiting update: ask the new worker to take over; controllerchange then reloads once into the fresh shell. */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage('skipWaiting');
  else location.reload();
}

export function initPwa(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').then((reg) => {
    const announce = (w: ServiceWorker | null) => {
      if (!w) return;
      const onState = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; listener?.(); } };
      if (w.state === 'installed' && navigator.serviceWorker.controller) onState();
      w.addEventListener('statechange', onState);
    };
    if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; listener?.(); }
    reg.addEventListener('updatefound', () => announce(reg.installing));
    // the new worker took control: reload exactly once so the fresh shell is in effect
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
    const poll = () => { reg.update().catch(() => undefined); };
    setInterval(poll, 60 * 60 * 1000);
    window.addEventListener('focus', poll);
  }).catch(() => undefined);
}
