/** Bound every Supabase HTTP request, including auth refresh and REST reads.
 * A hung read must release its poll so the next refresh can recover. */
export async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const parent = init?.signal ?? (input instanceof Request ? input.signal : null);
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 12000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Keep the deadline through body delivery, not only until headers arrive.
    await response.clone().arrayBuffer();
    return response;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
