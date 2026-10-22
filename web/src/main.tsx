import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SessionProvider } from './state/session.tsx';
import './theme.css';

// apply the saved "reduce motion" preference before first paint so it also governs the pure-CSS animations
try { if (localStorage.getItem('allin.reducedMotion') === '1') document.documentElement.setAttribute('data-reduce-motion', ''); } catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider><App /></SessionProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').then((reg) => {
      // a new build waits until the page is reloaded by the user; never force a reload mid-hand
      reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) console.info('All In: update ready on next launch'); }); });
    }).catch(() => undefined);
  });
}
