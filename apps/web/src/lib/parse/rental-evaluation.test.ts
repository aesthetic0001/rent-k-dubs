import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  ModeSchema, ParseRequestSchema, ParseResponseSchema, SearchCriteriaSchema, SearchSortSchema,
  TravelTargetSchema, type SearchIntent, type TravelTarget,
} from '@rentkdubs/shared/schemas';
import { createRuntime } from '../api/runtime';
import { poiClient } from '../geo/poi-client';
import { DestinationResolver, ParseService } from './index';
import { searchExtractor } from './local-extractor';
import { normalizePlace } from './place-name';

const common = {
  hard: z.boolean(),
  maxMinutes: z.number().positive().nullable(),
  modes: z.array(ModeSchema).min(1).optional(),
};
const travel = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('place'), name: z.string().min(1).max(500) }),
  z.strictObject({
    ...common, kind: z.literal('amenity'), category: TravelTargetSchema.shape.category.unwrap(),
    schoolLevel: z.enum(['elementary', 'secondary']).optional(),
  }),
]);
const split = z.enum(['development', 'holdout']);
const datasetSchema = z.strictObject({
  version: z.literal(1),
  referenceDate: z.iso.date(),
  areas: z.record(z.string().min(1), z.string().startsWith('WPD-')),
  entries: z.array(z.strictObject({
    id: z.string().min(1),
    group: z.string().min(1),
    split,
    prompt: ParseRequestSchema.shape.prompt,
    expected: z.strictObject({
      criteria: SearchCriteriaSchema.optional(),
      areas: z.array(z.string()).optional(),
      sortBy: SearchSortSchema.optional(),
      travel: z.array(travel).optional(),
    }),
  })).min(1),
});
const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL(
  '../../../../search/evaluation/waterloo-rentals-v1.json', import.meta.url,
), 'utf8')));
type GoldTrip = z.infer<typeof travel>;
type Expected = typeof dataset.entries[number]['expected'];

it('validates the rental evaluation labels and split', () => {
  expect(new Set(dataset.entries.map(row => row.id)).size).toBe(500);
  expect(new Set(dataset.entries.map(row => row.prompt.toLowerCase())).size).toBe(500);
  const groups = new Set(dataset.entries.map(row => row.group));
  expect(groups.size).toBe(10);
  for (const group of groups) {
    const rows = dataset.entries.filter(row => row.group === group);
    expect(rows.filter(row => row.split === 'development'), group).toHaveLength(10);
    expect(rows.filter(row => row.split === 'holdout'), group).toHaveLength(40);
  }
  const areaIds = new Set(Object.values(dataset.areas));
  expect(areaIds.size).toBe(Object.keys(dataset.areas).length);
  for (const { id, expected, prompt } of dataset.entries) {
    expect(new Set(expected.areas).size, id).toBe(expected.areas?.length ?? 0);
    for (const area of expected.areas ?? []) expect(areaIds.has(area), id).toBe(true);
    for (const target of expected.travel ?? []) {
      if (target.kind === 'place') {
        expect(normalizePlace(prompt).includes(normalizePlace(target.name)), id).toBe(true);
      }
      const [mode = 'walk', ...alternativeModes] = target.modes ?? [];
      const parsed = TravelTargetSchema.safeParse({
        id,
        label: target.kind === 'place' ? target.name : target.category,
        kind: target.kind,
        ...(target.kind === 'place' ? { query: target.name } : {
          category: target.category, schoolLevel: target.schoolLevel,
        }),
        mode,
        ...(alternativeModes.length ? { alternativeModes } : {}),
        maxMinutes: target.maxMinutes ?? undefined,
        hard: target.hard,
      });
      expect(parsed.success, id).toBe(true);
    }
  }
});

const comparableName = (value: string) => normalizePlace(value).replace(/^the /, '');

function targetMatches(expected: GoldTrip, actual: TravelTarget) {
  if (expected.kind !== actual.kind) return false;
  return expected.kind === 'place'
    ? comparableName(expected.name) === comparableName(actual.query ?? actual.label)
    : expected.category === actual.category;
}

function tripMatches(expected: GoldTrip, actual: TravelTarget) {
  return targetMatches(expected, actual) && expected.hard === actual.hard &&
    expected.maxMinutes === (actual.maxMinutes ?? null) &&
    (!expected.modes || isDeepStrictEqual([...expected.modes].sort(), [actual.mode, ...actual.alternativeModes ?? []].sort())) &&
    (expected.kind !== 'amenity' || expected.schoolLevel === (actual.schoolLevel === 'any' ? undefined : actual.schoolLevel));
}

function compare(expected: Expected, actual: Pick<SearchIntent, 'criteria' | 'areas' | 'sortBy' | 'travelTargets'>) {
  const criteria = expected.criteria ?? {};
  const travel = expected.travel ?? [];
  const differences: { field: string; expected?: unknown; actual?: unknown }[] = [];
  const counts = { criteriaMatched: 0, criteriaExpected: Object.keys(criteria).length,
    criteriaExtra: 0, travelMatched: 0, travelExpected: travel.length, travelExtra: 0 };
  for (const key of Object.keys(criteria) as (keyof typeof criteria)[]) {
    const first = criteria[key];
    const second = actual.criteria[key];
    const equal = key === 'unitTypes'
      ? !!actual.criteria.unitTypes && criteria.unitTypes!.hard === actual.criteria.unitTypes.hard &&
        isDeepStrictEqual([...criteria.unitTypes!.value].sort(), [...actual.criteria.unitTypes.value].sort())
      : isDeepStrictEqual(first, second);
    if (equal) counts.criteriaMatched++;
    else differences.push({ field: 'criteria.' + key, expected: first, actual: second });
  }
  for (const [key, value] of Object.entries(actual.criteria)) {
    if (!(key in criteria)) {
      counts.criteriaExtra++;
      differences.push({ field: 'criteria.' + key, actual: value });
    }
  }
  const remaining = actual.travelTargets.slice();
  const unmatched = travel.filter(target => {
    const index = remaining.findIndex(trip => tripMatches(target, trip));
    if (index < 0) return true;
    remaining.splice(index, 1);
    counts.travelMatched++;
    return false;
  });
  for (const target of unmatched) {
    const index = remaining.findIndex(trip => targetMatches(target, trip));
    differences.push({ field: 'travel', expected: target, actual: index < 0 ? undefined : remaining.splice(index, 1)[0] });
  }
  for (const actual of remaining) differences.push({ field: 'travel', actual });
  counts.travelExtra = remaining.length;

  const areas = actual.areas.map(area => area.kind === 'neighbourhood' ? area.id : area.kind).sort();
  if (!isDeepStrictEqual([...(expected.areas ?? [])].sort(), areas))
    differences.push({ field: 'areas', expected: expected.areas ?? [], actual: areas });
  if ((expected.sortBy ?? 'best_match') !== actual.sortBy)
    differences.push({ field: 'sortBy', expected: expected.sortBy ?? 'best_match', actual: actual.sortBy });
  return { differences, counts };
}

it('scores strict and optional same-category trips separately and detects unexpected duplicates', () => {
  const school = { kind: 'amenity' as const, category: 'school' as const, hard: true, maxMinutes: 10, modes: ['walk' as const] };
  const park = { kind: 'amenity' as const, category: 'park' as const, hard: false, maxMinutes: null };
  const target = { kind: 'amenity' as const, category: 'school' as const, hard: true, maxMinutes: 10,
    mode: 'walk' as const, id: 'primary', label: 'school', schoolLevel: 'elementary' as const };
  const actual = {
    criteria: {},
    areas: [],
    sortBy: 'best_match',
    travelTargets: [target, { ...target, id: 'secondary', schoolLevel: 'secondary' },
      { ...target, id: 'duplicate' }],
  } satisfies Pick<SearchIntent, 'criteria' | 'areas' | 'sortBy' | 'travelTargets'>;
  const result = compare({ travel: [
    { ...school, schoolLevel: 'secondary' }, { ...school, schoolLevel: 'elementary' }, park,
  ] }, actual);
  expect(result.counts).toMatchObject({ travelExpected: 3, travelMatched: 2, travelExtra: 1 });
  expect(result.differences).toHaveLength(2);
});

const output = process.env.SEARCH_EVAL_OUTPUT;
it.skipIf(!output)('evaluates Waterloo rental queries through the search parse API', async () => {
  const input = process.env.SEARCH_EVAL_DATASET;
  const benchmark = input ? datasetSchema.parse(JSON.parse(readFileSync(input, 'utf8'))) : dataset;
  const selected = z.enum(['all', 'development', 'holdout']).parse(process.env.SEARCH_EVAL_SPLIT ?? 'holdout');
  let rows = benchmark.entries.filter(row => selected === 'all' || row.split === selected);
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
  if (process.env.SEARCH_EVAL_LIMIT) {
    const limit = z.coerce.number().int().min(1).max(rows.length).parse(process.env.SEARCH_EVAL_LIMIT);
    rows = Array.from({ length: limit }, (_, i) => rows[Math.floor(i * rows.length / limit)]!);
  }
  const extractor = searchExtractor(process.env.SEARCH_EXTRACTOR_TEST_URL);
  const poi = poiClient(process.env.POI_TEST_URL);
  const service = new ParseService({
    extractor,
    poiMentions: poi?.mentions,
    resolver: new DestinationResolver({ poiLookup: poi?.resolve }),
    now: () => new Date(benchmark.referenceDate + 'T12:00:00Z'),
    civicAreas: async () => Object.entries(benchmark.areas).map(([name, id]) => ({ kind: 'neighbourhood' as const, id, name, number: null })),
  });
  const api = createRuntime({ env: {}, parser: service, identity: request => new URL(request.url).searchParams.get('case')! });
  const summary = { exact: 0, total: rows.length, parseErrors: 0, fallback: 0,
    criteriaMatched: 0, criteriaExpected: 0, criteriaExtra: 0, travelMatched: 0, travelExpected: 0, travelExtra: 0 };
  const byGroup: Record<string, { exact: number; total: number }> = {};
  const results = [];
  try {
    for (const row of rows) {
      const started = performance.now();
      const response = await api.parse(new Request('http://localhost/api/search/parse?case=' + row.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: row.prompt }),
      }), undefined);
      const elapsedMs = Math.round(performance.now() - started);
      const group = byGroup[row.group] ??= { exact: 0, total: 0 };
      group.total++;
      const parsed = response.ok ? ParseResponseSchema.safeParse(await response.json()) : undefined;
      if (!parsed?.success) {
        summary.parseErrors++;
        summary.criteriaExpected += Object.keys(row.expected.criteria ?? {}).length;
        summary.travelExpected += row.expected.travel?.length ?? 0;
        results.push({ id: row.id, prompt: row.prompt, elapsedMs, error: 'Parse response status ' + response.status });
        continue;
      }
      const { counts, differences } = compare(row.expected, parsed.data.intent);
      for (const field of Object.keys(counts) as (keyof typeof counts)[]) summary[field] += counts[field];
      if (parsed.data.parser === 'fallback') summary.fallback++;
      if (!differences.length) { summary.exact++; group.exact++; }
      results.push({ id: row.id, prompt: row.prompt, parser: parsed.data.parser, elapsedMs, differences });
    }
  } finally {
    api.jobs.dispose();
  }
  const latency = results.map(row => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (p: number) => latency[Math.ceil(p * latency.length) - 1];
  writeFileSync(output!, JSON.stringify({
    version: benchmark.version, split: selected, extractor: Boolean(extractor), poi: Boolean(poi),
    summary, byGroup, latencyMs: { p50: percentile(0.5), p95: percentile(0.95) }, results,
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}, 30 * 60_000);
