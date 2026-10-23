import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SessionProvider } from './state/session.tsx';
import { initPwa } from './lib/pwa.ts';
import './theme.css';

// apply the saved "reduce motion" preference before first paint so it also governs the pure-CSS animations
try { if (localStorage.getItem('allin.reducedMotion') === '1') document.documentElement.setAttribute('data-reduce-motion', ''); } catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider><App /></SessionProvider>
  </StrictMode>,
);

window.addEventListener('load', () => initPwa());
