import { SearchIntentSchema, SearchUnitTypeSchema, type SearchIntent, type TravelTarget, type AreaFilter } from '../../../../../packages/shared/schemas/index';

import { civicAreaMatches, type CivicArea } from './civic-areas';
import { normalizePlace as normalizePlaceName } from './place-name';
import { placeCatalogue, type PlaceMention } from './place-catalogue';
import { namedParkMentions } from './named-parks';
import { safetyPreference } from './safety-preference';
import { isRequired } from './requirement';
import { decimal, explicitMeasure, historicalConstraint } from './quantities';
import { listingFeature } from './amenities-in-unit';
import type { SourcedTarget } from './local-extractor';

export const anyUnitType = /\bany (?:unit |rental )?type\b/i;
export const configuredAreas: Record<string, AreaFilter> = {};
const amount = (n: string) => Number(n.replace(/[$,\s]/g, '').replace(/k$/i, '')) * (/k$/i.test(n) ? 1000 : 1);
export const modes = (s: string): TravelTarget['mode'][] => [...new Set([...s.toLowerCase().matchAll(/\b(transit|grt|ion|lrt|train|subway|commute|bus|car|drive|driving|walk|walking|on foot|bike|biking|bicycle|cycling)\b/g)].map(m => /car|driv/.test(m[0]) ? 'drive' as const : /walk|foot/.test(m[0]) ? 'walk' as const : /bik|cycl/.test(m[0]) ? 'bike' as const : 'transit' as const))];
export const schoolLevel = (text: string) =>
  /\b(?:elementary|primary)\s+schools?\b/i.test(text) ? 'elementary' as const :
    /\b(?:secondary|high)\s+schools?\b/i.test(text) ? 'secondary' as const : undefined;
const minRent = 'no (?:less|lower) than|at least|minimum(?: rent)?(?: of| is)?|rent (?:starts at|floor(?: of| is| to)?)|over|above';
const maxRent = "don['’]t (?:go|pay) (?:over|above|past)|won['’]t (?:pay|spend) more than|(?:no|neither for) (?:more|higher) than|no (?:monthly )?rent (?:over|above)|(?:capped|cap (?:it|(?:the )?rent)) at|(?:rent )?(?:cap|ceiling)(?: of| is| to| at)?|(?:hard |monthly )?(?:spending )?limit(?: for rent)?(?: of| is)?|upper end at|(?:my )?target for rent(?: is)?|all (?:i|we) can pay is|rent can be|rent (?:cannot|can['’]t) exceed|under|below|less than|at most|up to|max(?:imum)?(?: rent)?(?: of| is)?|budget(?: of| is)?";
const rentBefore = new RegExp('\\b(' + maxRent + '|' + minRent + ')(?:\\s+(?:around|about|roughly|approximately))?\\s*:?\\s*$', 'i');
const rentAfter = /^\s*(?:(?:cad|dollars?)\b\s*)?(?:(?:\/\s*mo\b|(?:a|per)\s+month\b|monthly\b)\s*)?(or (?:less|more|lower|higher|below|above)|,\s*(?:so\s+)?make that the cap|is (?:my |the )?(?:rent )?(?:maximum|minimum|max|min|cap|ceiling)|for the first month,\s*and that[’']s my (?:monthly )?rent ceiling|tops|at (?:the )?(?:most|least)|as the (?:rent )?(?:maximum|minimum|cap|ceiling)|(?:rent )?(?:max(?:imum)?|min(?:imum)?|cap|ceiling))\b/i;
export const rentPrefix = (text: string) => {
  const match = rentBefore.exec(text);
  return match ? { bound: new RegExp('^(?:' + minRent + ')$', 'i').test(match[1]) ? 'min' as const : 'max' as const, match } : undefined;
};
export const rentSuffix = (text: string) => {
  const match = rentAfter.exec(text);
  return match ? { bound: /more|higher|least|above|\bmin(?:imum)?\b/i.test(match[1]) ? 'min' as const : 'max' as const, match } : undefined;
};
export const ignoredRent = (before: string, after: string) => {
  const clause = before.split(/[;!?\n]|(?<!\d),|,(?!\d)|\.(?=\s|$)|\b(?:and|but)\b/i).at(-1) ?? '';
  const trailingBound = /^\s*(?:rent\s+)?(?:cap|range|ceiling|limit|budget)\b/i.test(after);
  return /\b(?:ignore|forget|disregard|drop|remove)\b/i.test(clause) &&
    (trailingBound || /\b(?:rent|budget|cap|ceiling)\b/i.test(clause)) ||
    trailingBound && /\bdon['’]t (?:want to |need to )?(?:use|apply|keep)\s+(?:(?:the|my|that|a)\s+)?$/i.test(clause);
};
export function fallbackParse(rawPrompt: string, now = new Date(), catalogue: CivicArea[] = [], travel?: { targets: SourcedTarget[]; dropped: SearchIntent['droppedRequests'] }, places: PlaceMention[] = []): SearchIntent {
  const intent: SearchIntent = { schemaVersion: 1, rawPrompt, areas: [], criteria: {}, travelTargets: [], safety: { enabled: false, hard: false }, sortBy: 'best_match', fieldSources: {}, droppedRequests: [] };
  const source = (field: string, phrase: string) => { intent.fieldSources[field] = { source: 'ai_prompt', phrase }; };
  const put = <K extends keyof SearchIntent['criteria']>(field: K, value: NonNullable<SearchIntent['criteria'][K]>['value'], phrase: string) => {
    const start = rawPrompt.indexOf(phrase);
    Object.assign(intent.criteria, { [field]: { value, hard: isRequired(rawPrompt, start, start + phrase.length) } });
    source(`criteria.${field}`, phrase);
  };
  const drop = (phrase: string, reason: string) => intent.droppedRequests.push({ phrase, reason });
  for (const [name, area] of Object.entries(configuredAreas)) { const m = rawPrompt.match(new RegExp(`\\b${name}\\b`, 'i')); if (m) { intent.areas.push(area); source('areas', m[0]); } }
  const areaMentions = civicAreaMatches(rawPrompt, catalogue);
  for (const match of areaMentions) {
    if (match.ambiguous) { if (!intent.droppedRequests.some(d => d.phrase === match.phrase)) drop(match.phrase, 'Area name is ambiguous.'); }
    else if (!intent.areas.some(a => a.kind === match.area.kind && 'id' in a && a.id === ('id' in match.area ? match.area.id : ''))) { intent.areas.push(match.area); source('areas', match.phrase); }
  }
  const income = rawPrompt.match(/(?:make|earn|income(?: of| is)?)\s+(?:about\s+)?(\$?[\d,]+(?:\.\d+)?k?)/i);
  if (income) { intent.household = { annualIncomeCad: amount(income[1]) }; source('household.annualIncomeCad', income[0]); }
  const people = rawPrompt.match(/\b(\d+)\s+(?:people|persons|of us)\b/i);
  if (people) { intent.household = { ...intent.household, people: Number(people[1]) }; source('household.people', people[0]); }
  const money = `\\$?${decimal}k?`;
  const floorSize = explicitMeasure(rawPrompt, 'sizeSqft');
  if (floorSize) {
    const { min, max } = floorSize.value;
    if (min !== undefined && max !== undefined && min > max) drop(floorSize.phrase, 'Floor-area bounds are reversed; clarify the range.');
    else put('sizeSqft', floorSize.value, floorSize.phrase);
  }
  const insideFloorSize = (start: number) => floorSize && start >= floorSize.start && start < floorSize.start + floorSize.phrase.length;
  const nonRentUnit = /^\s*[-+]?\s*(?:sqft|sq\.?\s*ft|square feet|bedrooms?|beds?|bathrooms?|baths?|rooms?|years?|min(?:ute)?s?|results?)\b|^\s*%/i;
  const rentRange = [...rawPrompt.matchAll(new RegExp(`(?:between\\s+)?(${money})\\s*(?:-|–|to|and)\\s*(${money})(?:\\s*(?:per|a|\\/)?\\s*(?:month|monthly|mo)\\b|\\s+per\\b)?`, 'gi'))].find(m =>
    !insideFloorSize(m.index) &&
    !(income && m.index >= income.index! && m.index < income.index! + income[0].length) &&
    !ignoredRent(rawPrompt.slice(0, m.index), rawPrompt.slice(m.index + m[0].length)) &&
    !nonRentUnit.test(rawPrompt.slice(m.index + m[0].length)) &&
    (/[$k]|\bper\b|month/i.test(m[0]) || /rent|budget|price/i.test(rawPrompt.slice(Math.max(0, m.index - 20), m.index)))
  );
  if (rentRange) {
    const a = amount(rentRange[1]), b = amount(rentRange[2]);
    // A shared trailing k applies to both ends of an abbreviated range such as 3–5k.
    const min = /k$/i.test(rentRange[2]) && !/k$/i.test(rentRange[1]) && a < 100 ? a * 1000 : a;
    if (min <= b) put('rent', { min, max: b }, rentRange[0]); else drop(rentRange[0], 'Rent bounds are reversed; clarify the range.');
  } else {
    for (const match of rawPrompt.matchAll(new RegExp(`(?<![\\w.,])${money}`, 'gi'))) {
      const start = match.index, end = start + match[0].length;
      const before = rawPrompt.slice(Math.max(0, start - 50), start), after = rawPrompt.slice(end);
      const prefix = rentPrefix(before), suffix = rentSuffix(after);
      const target = /\b(?:targeting|aiming for)\s+(?:about|around|roughly|approximately)\s*$/i.test(before) &&
        /^\s+(?:in|for) rent\b/i.test(after);
      const bound = prefix?.bound ?? suffix?.bound ?? (target ? 'max' : undefined);
      if (!bound || insideFloorSize(start) || ignoredRent(rawPrompt.slice(0, start), after) || income && start >= income.index! && start < income.index! + income[0].length ||
        nonRentUnit.test(after) || /^\s+(?:dollars?\s+)?(?:per (?:person|bedroom|year)|deposit\b)/i.test(after)) continue;
      const rentContext = /[$k]/i.test(match[0]) || /\b(?:rent|budget|price|monthly|cad|dollars?|per month)\b/i.test(before.slice(-28) + ' ' + after.slice(0, 28));
      if (!rentContext && (!prefix || amount(match[0]) < 100)) continue;
      const next = bound === 'min' ? new RegExp(`^\\s+(?:and|but)\\s+(?:can['’]t|cannot|must not) exceed\\s+(\\$${decimal}k?)`, 'i').exec(after) : null;
      const value = next && amount(next[1]) >= amount(match[0]) ? { min: amount(match[0]), max: amount(next[1]) } : { [bound]: amount(match[0]) };
      put('rent', value, rawPrompt.slice(start - (prefix?.match[0].length ?? 0), end + (next?.[0].length ?? suffix?.match[0].length ?? 0)));
      break;
    }
  }
  if (!intent.criteria.rent) {
    const budget = rawPrompt.match(new RegExp(`\\b(?:budget|maximum rent|max rent)(?:\\s+(?:of|is))?\\s*:?\\s*(${money})`, 'i'));
    if (budget && !ignoredRent(rawPrompt.slice(0, budget.index! + budget[0].indexOf(budget[1])), rawPrompt.slice(budget.index! + budget[0].length)) &&
      !nonRentUnit.test(rawPrompt.slice(budget.index! + budget[0].length))) put('rent', { max: amount(budget[1]) }, budget[0]);
  }
  if (!intent.criteria.rent) {
    const grand = rawPrompt.match(/\b(?:under|below|at most|no more than|up to)\s+(?:a|one) grand\b/i);
    if (grand && !ignoredRent(rawPrompt.slice(0, grand.index), rawPrompt.slice(grand.index! + grand[0].length))) put('rent', { max: 1000 }, grand[0]);
  }
  for (const field of ['bedrooms', 'bathrooms'] as const) {
    const measure = explicitMeasure(rawPrompt, field);
    if (measure && (measure.value.min === undefined || measure.value.max === undefined || measure.value.min <= measure.value.max)) {
      put(field, measure.value, measure.phrase);
    }
  }
  const excludedTypes: string[] = [];
  const types = [...rawPrompt.matchAll(/\b(basement[-\s]+(?:apartments?|suites?|units?)|(?:studio|bachelor)[-\s]+(?:apartments?|units?)|apartments?|condos?|basements?|houses?|townhouses?|townhomes?|rooms?|studios?|bachelors?)\b/gi)].flatMap(m => {
    const before = rawPrompt.slice(0, m.index), after = rawPrompt.slice(m.index + m[0].length);
    if (historicalConstraint(rawPrompt, m.index, m.index + m[0].length) ||
      /\bdon['’]t need\s+(?:(?:a|an|any)\s+)?$/i.test(before) ||
      /\bin the\s*$/i.test(before) && /^\s+itself\b/i.test(after) ||
      /\b(?:washer|dryer|laundry)\b[^.;!?]{0,35}\b(?:inside|in) the\s*$/i.test(before) ||
      /\b(?:in a shared|whole)\s*$/i.test(before) && /^house$/i.test(m[0])) return [];
    const singular = m[0].toLowerCase().replace(/s$/, '');
    const value = singular.startsWith('basement') ? 'basement' : singular === 'townhome' ? 'townhouse' : /^(?:bachelor|studio)/.test(singular) ? 'studio' : singular;
    if ( /\b(?:no|not|except|exclude|excluding)\s+(?:(?:a|an|any)\s+)?(?:(?:entire|whole|shared)\s+)?$/i.test(before) || /^\s+(?:is|are)\s+out\b/i.test(after)) {
      excludedTypes.push(value);
      return [];
    }
    return value === 'room' && (/\d+\s*$/.test(before) || /^\s+for (?:dogs?|cats?|pets?)\b/i.test(after)) ? [] : [{ start: m.index, end: m.index + m[0].length, value }];
  });
  if (excludedTypes.length || types.length && !anyUnitType.test(rawPrompt)) {
    const allowed = (types.length ? [...new Set(types.map(t => t.value))] : [...SearchUnitTypeSchema.options]).filter(t => !excludedTypes.includes(t));
    if (!allowed.length) drop(rawPrompt, 'Unit-type requirements contradict each other; choose allowed types.');
    else put('unitTypes', allowed as NonNullable<SearchIntent['criteria']['unitTypes']>['value'], excludedTypes.length ? rawPrompt : rawPrompt.slice(types[0].start, types.at(-1)!.end));
  }
  const buildSubject = 'built|constructed|completed|construction|construction year|build date|build year|year the building was (?:built|constructed|completed)';
  const buildRange = new RegExp(`\\b(?:${buildSubject})(?:\\s+somewhere)?\\s+(?:between|from|in the range(?: of)?)\\s+(\\d{4})\\s+(?:and|to|through)\\s+(\\d{4})\\b`, 'i');
  const buildBound = new RegExp(`\\b(?:${buildSubject})\\s+(?:(after|before|since|during|in|no earlier than|no later than)\\s+)?(?:(?:is|needs to be)\\s+)?(\\d{4})(?:\\s+(or (?:earlier|later|newer|older))\\b)?(?:\\s+(?:but|and)\\s+(?:before|no later than)\\s+(\\d{4}))?\\b`, 'i');
  const earliest = /\b(earliest|latest) acceptable (?:construction year|build year|build date) (?:is|of) (\d{4})\b/i;
  const built = [buildRange, earliest, buildBound].flatMap(re => [...rawPrompt.matchAll(new RegExp(re.source, 'gi'))])
    .find(match => !historicalConstraint(rawPrompt, match.index, match.index + match[0].length));
  if (built) {
    const year = Number(built[2]);
    const explicitRange = /^\d{4}$/.test(built[1] ?? '');
    const maxOnly = /^(?:before|no later than|latest)$/i.test(built[1] ?? '') || /earlier|older/i.test(built[3] ?? '');
    const minOnly = /^(?:after|since|no earlier than|earliest)$/i.test(built[1] ?? '') || /later|newer/i.test(built[3] ?? '');
    put('buildingAge', explicitRange ? { builtAfter: Number(built[1]), builtBefore: year } :
      built[4] ? { builtAfter: year, builtBefore: Number(built[4]) } :
      maxOnly ? { builtBefore: year } : minOnly ? { builtAfter: year } : { builtAfter: year, builtBefore: year }, built[0]);
  }
  else {
    const age = rawPrompt.match(/(less than|under|no more than|at most|maximum|more than|over|older than|at least|minimum|no less than)\s+(\d+)\s+years?\s+old|new build/i);
    if (age) {
      const year = now.getUTCFullYear() - Number(age[2] ?? 10);
      if (year < 1800 || year > 2100) drop(age[0], 'Building age is outside supported construction years; clarify the age.');
      else put('buildingAge', /^(?:more than|over|older than|at least|minimum|no less than)$/i.test(age[1] ?? '') ? { builtBefore: year } : { builtAfter: year }, age[0]);
    }
  }
  const ac = rawPrompt.match(/\b(?:central\s+(?:air|ac)|air conditioning|a\/c|ac)\b/i); if (ac && !historicalConstraint(rawPrompt, ac.index!, ac.index! + ac[0].length)) { if (/no\s*$/i.test(rawPrompt.slice(Math.max(0, ac.index! - 4), ac.index))) drop(ac[0], 'No-AC exclusion is unsupported; clarify.'); else put('airConditioning', /central/i.test(ac[0]) ? 'central' : 'any', ac[0]); }
  const pet = rawPrompt.match(/\b(?:cat(?:s)?[- ]friendly|dog(?:s)?[- ]friendly|cats?(?: allowed)?|dogs?(?: allowed)?|pet[- ]friendly|pets allowed)\b/i); if (pet && !historicalConstraint(rawPrompt, pet.index!, pet.index! + pet[0].length)) { if (/no\s*$/i.test(rawPrompt.slice(Math.max(0, pet.index! - 4), pet.index))) drop(pet[0], 'Pet exclusion is unsupported; clarify.'); else put('petsAllowed', /cat/i.test(pet[0]) ? 'cats' : /dog/i.test(pet[0]) ? 'dogs' : 'any', pet[0]); }
  for (const field of ['furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded'] as const) {
    const feature = listingFeature(rawPrompt, field);
    if (feature && feature.value !== null) put(field, feature.value, feature.phrase);
  }
  const lease = rawPrompt.match(/\b(?:month[- ]to[- ]month|short[- ]term (?:lease|rental|place)|(?:12[- ]month|twelve[- ]month|one[- ]year|year[- ]long) lease|((?:[1-9]|1[012]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)) months? (?:on|for) (?:the |a )?lease)\b/i);
  if (lease && !historicalConstraint(rawPrompt, lease.index!, lease.index! + lease[0].length)) {
    put('leaseTerm', /short|month[- ]to[- ]month/i.test(lease[0]) || lease[1] && !/^(?:12|twelve)$/i.test(lease[1]) ? 'short_term' : '12_months', lease[0]);
  }
  const safety = safetyPreference(rawPrompt); if (safety) { intent.safety = { enabled: safety.enabled, hard: safety.hard }; source('safety', safety.phrase); }
  const trueCost = rawPrompt.match(/\b(?:(?:lowest|cheapest) true monthly cost|(?:least expensive|lowest|cheapest) total (?:monthly )?cost)\b/i);
  const shortestMatch = rawPrompt.match(/\bshortest (?:trips?|commutes?|travel times?)\b/i);
  const shortest = shortestMatch && !/\bnot\s+(?:the\s+)?$/i.test(rawPrompt.slice(0, shortestMatch.index)) ? shortestMatch : null;
  const cheapest = rawPrompt.match(/\b(?:cheapest|lowest (?:rent|cost))\b/i);
  if (trueCost || shortest || cheapest) { intent.sortBy = trueCost ? 'lowest_true_cost' : shortest ? 'shortest_trips' : 'lowest_rent'; source('sortBy', (trueCost ?? shortest ?? cheapest)![0]); }
  if (!trueCost && !shortest && !cheapest) {
    const value = rawPrompt.match(/\bbest value\b/i);
    const newest = rawPrompt.match(/\b(?:newest (?:listings?|postings?)|latest (?:listings?|postings?)|most recently (?:listed|seen)|recently listed|newest first)\b/i);
    if (value || newest) { intent.sortBy = value ? 'best_value' : 'newest'; source('sortBy', (value ?? newest)![0]); }
  }
  if (travel) {
    for (const { target, phrase } of travel.targets) {
      intent.travelTargets.push(target);
      source(`travelTargets.${target.id}`, phrase);
    }
    intent.droppedRequests.push(...travel.dropped);
  } else {
  const travelAllowed = (start: number, end: number) => {
    const before = rawPrompt.slice(0, start).split(/[,;!?\n]|\.(?=\s|$)|\bbut\b/i).at(-1) ?? '';
    return !historicalConstraint(rawPrompt, start, end) &&
      !/^\s+(?:can|should) be ignored\b/i.test(rawPrompt.slice(end)) &&
      !/\b(?:even if|formerly|(?:months?|years?) ago|stopped commuting|nothing for|no need to|don['’]t solve for|leave the commute filter)\b/i.test(before);
  };
  const matchedPlaces = [...placeCatalogue.mentions(rawPrompt), ...places, ...namedParkMentions(rawPrompt).map(park => ({ start: park.index, end: park.index + park.phrase.length, query: park.phrase }))]
    .filter(match => !areaMentions.some(area => area.start <= match.start && match.end <= area.start + area.evidence.length))
    .filter(match => travelAllowed(match.start, match.end))
    .filter(match => !intent.areas.length || !configuredAreas[normalizePlaceName(match.query)])
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<PlaceMention[]>((matches, match) => { if (!matches.length || match.start >= matches[matches.length - 1].end) matches.push(match); return matches; }, []);
  const placeCount = matchedPlaces.length;
  const placeContext = rawPrompt.replace(/\d+\s*(?:minutes?|mins?)\s+(?:by\s+)?(?:transit|grt|ion|drive|walk|bike|car|walking|biking)\s+to\s+(?:(?:a|the|nearest)\s+)?(?:supermarkets?|grocer(?:y|ies)|(?:(?:public|elementary|primary|secondary|high) )?schools?|parks?|ion(?: stations?)?|subway|librar(?:y|ies)|pharmac(?:y|ies)|clinics?)\b/gi, match => ' '.repeat(match.length));
  const globalModes = placeCount <= 1 ? modes(placeContext) : [];
  const duration = /(\d+)\s*(?:minutes?|mins?)\b/i;
  const globalTime = placeContext.match(duration);
  const addTarget = (query: string, phrase: string, category: TravelTarget['category'], start: number, end: number, clauseStart = start, clauseEnd = end) => {
    const localText = rawPrompt.slice(clauseStart, clauseEnd);
    const level = category === 'school' ? schoolLevel(query) : undefined;
    const existing = intent.travelTargets.find(t => t.query && normalizePlaceName(t.query) === normalizePlaceName(query) || category && t.category === category && t.schoolLevel === level);
    const localTime = localText.match(duration);
    const time = localTime ?? (!category && placeCount <= 1 ? globalTime : null);
    const focus = time ? (localTime ? clauseStart : 0) + time.index! : start;
    const hard = isRequired(rawPrompt, focus, localTime ? Math.max(end, focus + localTime[0].length) : time ? focus + time[0].length : end);
    const selectedModes = modes(localText); const targetModes = selectedModes.length ? selectedModes : category ? ['walk' as const] : globalModes.length ? globalModes : time ? ['walk' as const] : ['transit' as const];
    if (existing) { if (time) { existing.mode = targetModes[0]; existing.alternativeModes = targetModes.length > 1 ? targetModes.slice(1) : undefined; existing.maxMinutes = Number(time[1]); existing.hard = hard; source(`travelTargets.${existing.id}`, localText.trim()); } return; }
    const id = `target-${intent.travelTargets.length + 1}`;
    intent.travelTargets.push({ id, kind: category ? 'amenity' : 'place', label: query, ...(category ? { category, schoolLevel: level } : { query }), mode: targetModes[0], ...(targetModes.length > 1 ? { alternativeModes: targetModes.slice(1) } : {}), ...(time ? { maxMinutes: Number(time[1]) } : {}), hard }); source(`travelTargets.${id}`, phrase);
  };
  for (const match of matchedPlaces) {
    const before = rawPrompt.slice(0, match.start), after = rawPrompt.slice(match.end);
    const preceding = before.split(/[;!?\n]|\.(?=\s|$)|(?<!\d),|,(?!\d)|\band\b/gi).at(-1) ?? '';
    const clauseStart = match.start - preceding.length;
    addTarget(match.query, match.query, undefined, match.start, match.end, clauseStart, match.end + after.split(/[,;.]|\band\b/i)[0].length);
    if (match.normalizedQuery) intent.travelTargets.find(t => t.query === match.query)!.normalizedQuery = match.normalizedQuery;
  }
  for (const [category, re] of [['grocery', /\b(?:groceries|grocery|supermarkets?)\b/gi], ['school', /\b(?:(?:(?:public|elementary|primary|secondary|high) )?schools?)\b/gi], ['park', /\bparks?\b/gi], ['rapid_transit', /\b(?:subway|ion stations?)\b/gi], ['library', /\blibrar(?:y|ies)\b/gi], ['pharmacy', /\bpharmac(?:y|ies)\b/gi], ['clinic', /\bclinics?\b/gi]] as const) {
    for (const m of rawPrompt.matchAll(re)) { if (!travelAllowed(m.index, m.index + m[0].length) || matchedPlaces.some(match => m.index! >= match.start && m.index! < match.end) || category === 'rapid_transit' && /by\s*$/i.test(rawPrompt.slice(0, m.index))) continue; const before = rawPrompt.slice(0, m.index); const clauseStart = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf(' and ')) + 1; addTarget(m[0], m[0], category, m.index!, m.index! + m[0].length, clauseStart); }
  }
  // Street abbreviations keep their dots; sentence ends and separately timed destinations stop capture.
  for (const m of rawPrompt.matchAll(/(\d+\s*(?:minutes?|mins?)\s+(?:(?:by\s+)?(?:transit|grt|ion|drive|walk|bike|car|walking|biking)\s+)?(?:to|of|from)\s+)((?:(?!\s+(?:and|but)\s+(?:(?:ideally|preferably|around|about|roughly|approximately|within|under|less than|no (?:longer|more) than|at most)\s+)*\d+\s*(?:minutes?|mins?)\b)(?:\b(?:st|ave|rd|blvd|dr|cres|ct|pl|hwy)\.(?=\s+\w)|[^,;.!?]))+)/gi)) {
    if (!travelAllowed(m.index + m[1].length, m.index + m[0].trimEnd().length)) continue;
    const amenity = /^(?:(?:a|the|nearest)\s+)?(supermarkets?|grocer(?:y|ies)|(?:(?:public|elementary|primary|secondary|high) )?schools?|parks?|ion(?: stations?)?|subway|librar(?:y|ies)|pharmac(?:y|ies)|clinics?)\b/i.exec(m[2].trim());
    const category: TravelTarget['category'] | undefined = amenity ? /supermarket|grocer/i.test(amenity[1]) ? 'grocery' : /school/i.test(amenity[1]) ? 'school' : /park/i.test(amenity[1]) ? 'park' : /subway|ion/i.test(amenity[1]) ? 'rapid_transit' : /librar/i.test(amenity[1]) ? 'library' : /pharmac/i.test(amenity[1]) ? 'pharmacy' : 'clinic' : undefined;
    if (category || !intent.travelTargets.some(t => t.query && m[2].toLowerCase().includes(t.query.toLowerCase()))) addTarget(m[2].trim(), m[0], category, m.index, m.index + m[0].trimEnd().length);
  }
  }
  for (const m of rawPrompt.matchAll(/\b(?:available|move[- ]in|lease|short[- ]term|12[- ]month)[^,.]*/gi)) drop(m[0], 'Basic parser cannot confirm this availability or lease request; edit the supported filter.');
  for (const m of rawPrompt.matchAll(/\b(?:no pets|balcony|balconies|big|spacious|luxury|quiet)\b/gi)) drop(m[0], 'No measurable supported criterion; clarify a numeric requirement.');
  if (!Object.keys(intent.criteria).length && !intent.travelTargets.length && !intent.areas.length && !intent.safety.enabled && intent.sortBy === 'best_match' && !intent.droppedRequests.length) drop(rawPrompt, 'Basic parser could not identify supported constraints; edit filters or clarify.');
  return SearchIntentSchema.parse(intent);
}
