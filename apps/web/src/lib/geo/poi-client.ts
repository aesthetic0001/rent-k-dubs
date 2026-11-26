import { z } from 'zod';
import { DestinationResolutionSchema } from '@rentkdubs/shared/schemas';

const mentionsResponse = z.object({
  mentions: z.array(z.object({
    text: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })).max(128),
});

export function poiClient(address: string | undefined, fetcher: typeof fetch = fetch) {
  if (!address) return undefined;
  const base = new URL(address);
  const post = async (path: string, body: object, signal?: AbortSignal): Promise<unknown> => {
    const timeout = AbortSignal.timeout(750);
    const response = await fetcher(new URL(path, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error('POI service unavailable');
    return response.json();
  };

  return {
    async mentions(prompt: string) {
      try {
        const { mentions } = mentionsResponse.parse(await post('/mentions', { prompt }));
        return mentions.flatMap(({ text, start, end }) =>
          start < end && prompt.slice(start, end) === text ? [{ start, end, query: text }] : []);
      } catch {
        return [];
      }
    },
    async resolve(query: string, signal?: AbortSignal, preferPrimaryCampus = true, near?: { lat: number; lng: number }) {
      try {
        const result = DestinationResolutionSchema.parse(await post('/resolve', { query, preferPrimaryCampus, near }, signal));
        if (result.query === query && result.status !== 'unavailable') return result;
      } catch {
        // Callers fall through to their existing location providers when the service is unavailable.
      }
    },
  };
}

export type PoiClient = NonNullable<ReturnType<typeof poiClient>>;
