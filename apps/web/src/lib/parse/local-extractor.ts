import { z } from 'zod';
import { ModeSchema, SearchCriteriaSchema, SearchIntentSchema, SearchSortSchema, TravelTargetSchema, type SearchIntent, type TravelTarget } from '../../../../../packages/shared/schemas/index';
import type { CivicArea } from './civic-areas';
import { anyUnitType, fallbackParse, ignoredRent, modes as keywordModes, schoolLevel, rentPrefix, rentSuffix } from './fallback';
import { namedParkMentions } from './named-parks';
import { placeCatalogue, type PlaceMention } from './place-catalogue';
import { normalizePlace } from './place-name';
import { isRequired } from './requirement';
import { historicalConstraint, quantity } from './quantities';
import { listingFeature } from './amenities-in-unit';

const fields = z.enum([
  'rent', 'bedrooms', 'bathrooms', 'sizeSqft', 'unitTypes', 'buildingAge',
  'airConditioning', 'petsAllowed', 'furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded',
  'availableBy', 'leaseTerm', 'area', 'destination', 'amenity', 'sort',
]);
const span = z.strictObject({
  text: z.string().min(1).max(4000), start: z.number().int().min(0), end: z.number().int().max(4000),
  value: z.number().positive().max(100000).optional(), phrase: z.string().max(4000).optional(),
  choice: z.union([z.string(), z.array(z.string()).max(12)]).optional(),
  bound: z.enum(['min', 'max', 'exact', 'unspecified']).optional(),
  strength: z.enum(['require', 'prefer']).optional(),
});
const response = z.strictObject({
  // Accept evidence from older service instances during rollout. Retired fields are ignored.
  spans: z.partialRecord(fields.or(z.enum(['priceFairness', 'percentile'])), z.array(span).max(128)),
  trips: z.array(z.strictObject({
    destination: span, source: span, duration: span.nullable(), modeSpans: z.array(span).max(128),
    amenity: z.boolean(), category: z.string().optional(), strength: z.enum(['require', 'prefer']).optional(),
  })).max(128),
});
type Evidence = z.infer<typeof response>;
type Span = z.infer<typeof span>;
export type SourcedTarget = { target: TravelTarget; phrase: string };
export type LocalExtractor = (prompt: string, covered?: string[], places?: PlaceMention[]) => Promise<Evidence>;

export function searchExtractor(address: string | undefined, timeout = 2500): LocalExtractor | undefined {
  if (!address) return undefined;
  const endpoint = new URL('/extract', address);
  const budget = Number.isInteger(timeout) && timeout > 0 ? Math.min(timeout, 30_000) : 2500;
  return async (prompt, covered = [], hints = []) => {
    const candidates = [
      ...placeCatalogue.mentions(prompt), ...hints,
      ...namedParkMentions(prompt).map(p => ({ start: p.index, end: p.index + p.phrase.length })),
    ].map(({ start, end }) => ({ start, end, text: prompt.slice(start, end) }));
    const places = [...new Map(candidates.map(place => [place.start + ':' + place.end, place])).values()];
    const result = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, places, covered }),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(budget),
    });
    if (!result.ok) throw new Error('Local extraction unavailable');
    return response.parse(await result.json());
  };
}

const choices = (s: Span) => Array.isArray(s.choice) ? s.choice : s.choice ? [s.choice] : [];
const explicitBounds = {
  min: ['above', 'over', 'at least', 'no less than', 'minimum', 'minimum rent'],
  max: ['under', 'below', 'less than', 'no more than', 'at most', 'up to', 'maximum', 'maximum rent', 'budget', 'budget of', 'budget is'],
} as const;
function sourceBound(phrase: string, text: string): 'min' | 'max' | undefined {
  const before = phrase.slice(0, phrase.lastIndexOf(text)).toLowerCase().trim().replace(/\s+(?:about|around)$/, '');
  return (['min', 'max'] as const).flatMap(bound =>
    explicitBounds[bound].filter(word => before === word || before.endsWith(` ${word}`)).map(word => ({ bound, word }))
  ).sort((a, b) => b.word.length - a.word.length)[0]?.bound;
}
const onDate = (raw: string, now: Date) => {
  const text = raw.replace(/^(?:(?:available|move[- ]in|ready)\s+)?(?:by|on|before|from)\s+/i, '');
  if (/^now$/i.test(text)) return now.toISOString().slice(0, 10);
  if (z.iso.date().safeParse(text).success) return text;
  const date = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(text);
  if (!date) return undefined;
  const month = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(date[1].slice(0, 3).toLowerCase());
  if (month < 0) return undefined;
  const day = Number(date[2]), year = Number(date[3] ?? now.getUTCFullYear());
  const value = new Date(Date.UTC(year, month, day));
  if (value.getUTCMonth() !== month || value.getUTCDate() !== day) return undefined;
  if (!date[3] && value.toISOString().slice(0, 10) < now.toISOString().slice(0, 10)) value.setUTCFullYear(year + 1);
  return value.toISOString().slice(0, 10);
};

export function localIntent(prompt: string, evidence: Evidence, catalogue: CivicArea[], now = new Date(), places: PlaceMention[] = []): SearchIntent {
  const grounded = (s: Span) => s.end > s.start && prompt.slice(s.start, s.end) === s.text;
  const recognized = placeCatalogue.mentions(prompt);
  const travel: { targets: SourcedTarget[]; dropped: SearchIntent['droppedRequests'] } = { targets: [], dropped: [] };
  const byDestination = new Map<string, SourcedTarget>();
  for (const trip of evidence.trips) {
    const { destination, source, duration, modeSpans } = trip;
    if (!grounded(destination) || !grounded(source) || source.start > destination.start || source.end < destination.end) continue;
    const inside = (s: Span) => grounded(s) && s.start >= source.start && s.end <= source.end &&
      (s.end <= destination.start || s.start >= destination.end);
    if (duration && !inside(duration)) continue;
    const quarter = duration ? /(?:(three)\s+quarters|quarter)(?:\s+of\s+an)?[\s-]+hour\b/i.exec(duration.text) : null;
    const length = quarter ? (quarter[1] ? 0.75 : 0.25) : duration ? quantity(duration.text) : undefined;
    const minutes = length === undefined ? undefined : length * (/hours?|hrs?\b/i.test(duration!.text) ? 60 : 1);
    if (duration && !(minutes && minutes > 0)) {
      travel.dropped.push({ phrase: source.text, reason: 'Specify a positive travel time in minutes or hours.' });
      continue;
    }
    const mode = modeSpans.filter(inside).flatMap(s => {
      const decoded = ModeSchema.safeParse(s.choice);
      return decoded.success ? [decoded.data] : [];
    });
    // Reuse the existing parser's vocabulary only if the classifier missed a mode within this exact clause.
    const modeContext = prompt.slice(source.start, destination.start) + ' ' + prompt.slice(destination.end, source.end);
    const alternative = /\bor\s+(?:(?:by|on)\s+)?(?:bike|bicycle|bus|transit|car|drive|walk|foot)\b/i.test(modeContext);
    const explicit = [...new Set(mode.length ? [...mode, ...(alternative ? keywordModes(modeContext) : [])] : keywordModes(modeContext))];
    const qualifier = /(?:elementary|primary|secondary|high)\s+$/i.exec(prompt.slice(source.start, destination.start))?.[0] ?? '';
    const level = trip.category === 'school' ? schoolLevel(qualifier + destination.text) : undefined;
    const known = recognized.find(place => place.start === destination.start && place.end === destination.end);
    const parsed = TravelTargetSchema.safeParse({
      id: `target-${travel.targets.length + 1}`, label: destination.text,
      mode: explicit[0] ?? (duration || trip.amenity ? 'walk' : 'transit'),
      ...(explicit.length > 1 ? { alternativeModes: explicit.slice(1) } : {}),
      ...(minutes === undefined ? {} : { maxMinutes: minutes }),
      hard: !/^\s*[.!?]\s*i['’]m flexible about how close\b/i.test(prompt.slice(source.end)) &&
        isRequired(prompt, Math.min(duration?.start ?? destination.start, destination.start), source.end),
      ...(trip.amenity ? { kind: 'amenity', category: trip.category, schoolLevel: level } :
        { kind: 'place', query: destination.text, ...(known?.normalizedQuery ? { normalizedQuery: known.normalizedQuery } : {}) }),
    });
    if (!parsed.success) continue;
    const key = trip.amenity ? `amenity:${trip.category}:${level ?? ''}` : normalizePlace(destination.text);
    const prior = byDestination.get(key);
    if (prior) {
      if (prior.target.maxMinutes === undefined && minutes !== undefined) Object.assign(prior, { target: { ...parsed.data, id: prior.target.id }, phrase: source.text });
      else if (minutes !== undefined && (prior.target.maxMinutes !== minutes || prior.target.mode !== parsed.data.mode)) {
        travel.dropped.push({ phrase: source.text, reason: 'Choose one time limit and set of travel modes per destination.' });
      }
    } else {
      const entry = { target: parsed.data, phrase: source.text };
      byDestination.set(key, entry);
      travel.targets.push(entry);
    }
  }
  const intent = fallbackParse(prompt, now, catalogue, travel.targets.length || travel.dropped.length ? travel : undefined, places);
  const sortPhrase = intent.fieldSources.sortBy?.phrase;
  const found = (key: keyof Evidence['spans']) => (evidence.spans[key] ?? [])
    .filter(s => grounded(s) && (key === 'sort' || s.text !== sortPhrase));
  const phrase = (s: Span) => s.phrase && prompt.includes(s.phrase) && s.phrase.includes(s.text) ? s.phrase : s.text;
  const required = (s: Span) => isRequired(prompt, s.start, s.end);
  const set = (key: keyof SearchIntent['criteria'], value: unknown, spans: Span[]) => {
    const parsed = SearchCriteriaSchema.shape[key].safeParse({ value, hard: spans.every(required) });
    if (!parsed.success) return;
    Object.assign(intent.criteria, { [key]: parsed.data });
    const report = spans.length === 1 ? phrase(spans[0]) : prompt.slice(Math.min(...spans.map(s => s.start)), Math.max(...spans.map(s => s.end)));
    intent.fieldSources[`criteria.${key}`] = { source: 'ai_prompt', phrase: report };
  };
  for (const key of ['rent', 'bedrooms', 'bathrooms', 'sizeSqft'] as const) {
    const existing = intent.criteria[key];
    if (key !== 'rent' && existing) continue;
    const prior = existing?.value;
    const bounds = { ...prior };
    const support: Span[] = [];
    const amountOf = (s: Span) => {
      if (key === 'bedrooms' && /\b(?:one|1)\s+room\b/i.test(s.text) && /\bshared\b/i.test(prompt.slice(s.end, s.end + 25))) return undefined;
      if (key !== 'rent' && historicalConstraint(prompt, s.start, s.end)) return undefined;
      if (key === 'rent' && ignoredRent(prompt.slice(0, s.start), prompt.slice(s.end))) return undefined;
      const size = intent.fieldSources['criteria.sizeSqft']?.phrase;
      if (key === 'rent' && size) {
        const start = prompt.indexOf(size);
        if (s.start >= start && s.end <= start + size.length) return undefined;
      }
      // Listing criteria need listing quantities rather than percentages or result counts.
      if (/%|\bpercent\b|\bresults?\b/i.test(s.text) || /^\s*(?:%|percent\b|results?\b)/i.test(prompt.slice(s.end))) return undefined;
      return key === 'rent' ? s.value ?? (/\d/.test(s.text) ? quantity(s.text) : undefined) : quantity(s.text);
    };
    const candidates = found(key).sort((a, b) => a.start - b.start);
    if (bounds.min === undefined && bounds.max === undefined && candidates.length === 2) {
      const [first, last] = candidates;
      const join = prompt.slice(first.end, last.start).trim().toLowerCase();
      const prefix = phrase(first).slice(0, phrase(first).lastIndexOf(first.text)).trim().toLowerCase();
      const a = amountOf(first), b = amountOf(last);
      if (a !== undefined && b !== undefined && a <= b &&
        (['to', '-', '–'].includes(join) || join === 'and' && prefix.endsWith('between'))) {
        set(key, { min: a, max: b }, [first, last]);
        continue;
      }
    }
    for (const s of candidates) {
      const amount = amountOf(s);
      const preceding = prompt.slice(Math.max(0, s.start - 50), s.start);
      const bound = key === 'rent'
        ? rentPrefix(preceding)?.bound ??
          rentSuffix(prompt.slice(s.end))?.bound ?? sourceBound(phrase(s), s.text)
        : sourceBound(phrase(s), s.text) ?? (s.bound === 'unspecified' ? 'exact' : s.bound ?? 'exact');
      if (amount === undefined || !Number.isFinite(amount) || !bound ||
        existing && existing.hard !== required(s)) continue;
      const before = { ...bounds };
      if (bounds.min === undefined && (bound === 'min' || bound === 'exact')) bounds.min = amount;
      if (bounds.max === undefined && (bound === 'max' || bound === 'exact')) bounds.max = amount;
      if (bounds.min !== before.min || bounds.max !== before.max) support.push(s);
    }
    if (support.length && (bounds.min !== prior?.min || bounds.max !== prior?.max)) set(key, bounds, support);
  }
  for (const key of ['unitTypes', 'airConditioning', 'petsAllowed', 'furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded', 'leaseTerm'] as const) {
    if (intent.criteria[key] || key === 'unitTypes' && anyUnitType.test(prompt)) continue;
    if ((key === 'furnished' || key === 'parking' || key === 'laundryInSuite' || key === 'utilitiesIncluded') && listingFeature(prompt, key)?.value === null) continue;
    const support = found(key).filter(s => choices(s).length && !historicalConstraint(prompt, s.start, s.end) &&
      (key !== 'unitTypes' || !/\broom(?:s)?\s+for (?:dogs?|cats?|pets?)\b/i.test(s.text + prompt.slice(s.end, s.end + 20)) && /\b(?:apartments?|condos?|basements?|houses?|townh(?:ouse|ome)s?|rooms?|studios?|bachelors?)\b/i.test(s.text)) &&
      (key !== 'petsAllowed' || !/\b(?:don['’]t|do not)\b[^.;!?]*\bpet filter\b/i.test(prompt)));
    const options = [...new Set(support.flatMap(choices))];
    if (!options.length) continue;
    const first = options[0];
    if (key === 'unitTypes') set(key, options, support);
    else if (options.length === 1) set(key, ['yes', 'no'].includes(first) ? first === 'yes' : first, support);
  }
  const dates = found('availableBy').filter(s => onDate(s.text, now));
  for (const s of dates) {
    const date = onDate(s.text, now);
    if (date) { set('availableBy', date, [s]); break; }
  }
  if (!intent.criteria.buildingAge) for (const s of found('buildingAge')) {
    if (historicalConstraint(prompt, s.start, s.end)) continue;
    if (dates.some(date => s.start < date.end && date.start < s.end)) continue;
    const year = quantity(s.text);
    if (year && typeof s.choice === 'string') {
      set('buildingAge', { ...(s.choice !== 'max' ? { builtAfter: year } : {}), ...(s.choice !== 'min' ? { builtBefore: year } : {}) }, [s]);
    }
  }
  const sort = found('sort')[0];
  if (sort && intent.sortBy === 'best_match' && !/\bnewer layout\b/i.test(sort.text)) {
    const choice = SearchSortSchema.safeParse(sort.choice);
    if (choice.success) {
      intent.sortBy = choice.data;
      intent.fieldSources.sortBy = { source: 'ai_prompt', phrase: phrase(sort) };
    }
  }
  intent.droppedRequests = intent.droppedRequests.filter(drop =>
    !(drop.reason.startsWith('Basic parser cannot confirm') && (['leaseTerm', 'availableBy'] as const).some(key =>
      intent.criteria[key] && found(key).some(s => drop.phrase.includes(s.text)))) &&
    !(Object.keys(intent.criteria).length && drop.reason.startsWith('Basic parser could not identify')));
  return SearchIntentSchema.parse(intent);
}
