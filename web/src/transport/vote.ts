import { TransportError, type Transport } from './types.ts';

/** Concurrent votes can exhaust the server's compare-and-set attempts. Retry only
 * that explicit, uncommitted conflict; preserve the receipt key across attempts. */
export async function submitVote(transport: Pick<Transport, 'cmd'>, payload: Record<string, unknown>, tableId: string): Promise<unknown> {
  const actionId = crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    try { return await transport.cmd('vote', payload, tableId, actionId); }
    catch (error) {
      if (!(error instanceof TransportError) || error.code !== 'busy' || error.status !== 409 || attempt >= 3) throw error;
      // Dephase players who tapped together. No retry traffic when a vote succeeds.
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1) + Math.random() * 100));
    }
  }
}
