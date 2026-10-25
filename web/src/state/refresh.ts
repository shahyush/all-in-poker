/** At most one active read and one queued read per resource. Bursts share the
 * queued read; callers finish when their read finishes, even during a steady
 * stream of notifications. A failed read never blocks subsequent recovery. */
export function coalescedRefresh(read: () => Promise<void>): () => Promise<void> {
  let active: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const request = Promise.resolve().then(read).finally(() => {
      if (active === request) active = null;
    });
    active = request;
    return request;
  };
  return () => {
    if (queued) return queued;
    if (!active) return start();
    const next = () => { queued = null; return start(); };
    queued = active.then(next, next);
    return queued;
  };
}
