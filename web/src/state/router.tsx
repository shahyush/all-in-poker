import { useCallback, useEffect, useState } from 'react';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export function pathOf(): string {
  const p = window.location.pathname;
  return (p.startsWith(BASE) ? p.slice(BASE.length) : p) || '/';
}
export function navigate(to: string, replace = false): void {
  const url = BASE + to;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function useRoute(): { path: string; go: (to: string, replace?: boolean) => void } {
  const [path, setPath] = useState(pathOf());
  useEffect(() => { const h = () => setPath(pathOf()); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);
  const go = useCallback((to: string, replace?: boolean) => navigate(to, replace), []);
  return { path, go };
}
export function absoluteUrl(to: string): string { return window.location.origin + BASE + to; }
