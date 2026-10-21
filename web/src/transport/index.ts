import { DevTransport } from './dev.ts';
import { SupabaseTransport } from './supabase.ts';
import type { Transport } from './types.ts';
export * from './types.ts';

export function createTransport(): Transport {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const dev = import.meta.env.VITE_DEV_API as string | undefined;
  if (dev) return new DevTransport(dev);
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY');
  return new SupabaseTransport(url, key);
}
