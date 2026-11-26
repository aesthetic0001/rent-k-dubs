import { expect, it } from 'vitest';
import { createRuntime } from '../api/runtime';
import { poiClient } from './poi-client';

it('uses only service mentions with verbatim UTF-16 offsets', async () => {
  const service = poiClient('http://poi.test', async () => Response.json({ mentions: [
    { text: 'T&T', start: 8, end: 11 },
    { text: 'invented', start: 0, end: 8 },
  ] }))!;
  expect(await service.mentions('🏠 Near T&T')).toEqual([{ start: 8, end: 11, query: 'T&T' }]);
  const unavailable = poiClient('http://poi.test', async () => new Response(null, { status: 503 }))!;
  expect(await unavailable.mentions('Near T&T')).toEqual([]);
  expect(await unavailable.resolve('T&T')).toBeUndefined();
});

const poiUrl = process.env.POI_TEST_URL;
const extractorUrl = process.env.SEARCH_EXTRACTOR_TEST_URL;

it.skipIf(!poiUrl)('parses a named database POI and keeps the time limit on its own trip', async () => {
  for (const url of [undefined, extractorUrl].filter((url, i) => i === 0 || url)) {
    const api = createRuntime({ env: { POI_SERVICE_URL: poiUrl, SEARCH_EXTRACTOR_URL: url } });
    try {
      const response = await api.parse(new Request('http://localhost/api/search/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Near T&T, within 12 minutes biking to UW' }),
      }), undefined);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.parser).toBe(url ? 'gliner' : 'fallback');
      expect(result.intent.travelTargets).toMatchObject([
        { query: 'T&T', kind: 'place', hard: true },
        { query: 'UW', kind: 'place', mode: 'bike', maxMinutes: 12, hard: true },
      ]);
      expect(result.intent.travelTargets[0].maxMinutes).toBeUndefined();
      expect(result.destinations[0].resolution).toMatchObject({
        status: 'resolved', destination: { id: 'osm:node/1654542143' },
      });
      expect(result.destinations[1].resolution).toMatchObject({
        status: 'resolved',
        destination: { label: expect.stringMatching(/^University of Waterloo\b/), resolved: { lng: -80.5398, lat: 43.4723 } },
      });
    } finally {
      api.jobs.dispose();
    }
  }
});

it.skipIf(!poiUrl || !extractorUrl)('keeps a named park and a generic amenity as different target kinds', async () => {
  const api = createRuntime({ env: { POI_SERVICE_URL: poiUrl, SEARCH_EXTRACTOR_URL: extractorUrl } });
  try {
    const response = await api.parse(new Request('http://localhost/api/search/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Near Waterloo Park, within 9 minutes walking to the public library' }),
    }), undefined);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.parser).toBe('gliner');
    expect(result.intent.travelTargets).toMatchObject([
      { query: 'Waterloo Park', kind: 'place' },
      { kind: 'amenity', category: 'library', mode: 'walk', maxMinutes: 9 },
    ]);
    expect(result.intent.travelTargets[1].query).toBeUndefined();
  } finally {
    api.jobs.dispose();
  }
});
