import type { Listing, SearchIntent, Valuation, TravelTimeRow, Safety, MatchScore, Caveat } from '../schemas/index';
import { CAVEATS, engineConfig } from './config';
import { filterListing } from './filters';
import { homeFit, homeCriteria } from './home-fit';
import { clamp, travelScore, targetModes, targetDistanceM, estimateTravelMinutes, defaultMinutes } from './travel';
// D computes the optional score; this is a composition input, not D's exported Safety shape.
export type ScoreContext = { valuation: Valuation; travel: TravelTimeRow[]; safety: Safety | null; safetyScore?: number | null; caveats?: Caveat[] };
/** Value part. More than 30% below the estimate scores 50 so the other parts cannot scale up into the gap. */
export function valueScore(valuation: Pick<Valuation, 'status' | 'differencePct'>): number | null {
  if (valuation.status !== 'ok' || valuation.differencePct === undefined) return null;
  if (valuation.differencePct > CAVEATS.farBelowPct) return 50;
  return clamp(50 + valuation.differencePct * 2.5);
}
/** The part weights a search scores with: the defaults, safety opt-in, then the renter's own sliders. */
export function scoreWeights(intent: SearchIntent): Record<keyof typeof engineConfig.weights, number> {
  const weights = { ...engineConfig.weights, ...(intent.safety.enabled ? { safety: engineConfig.safetyWeight } : {}), ...intent.weights };
  if (!intent.safety.enabled) weights.safety = 0;
  return weights;
}
export function scoreListing(listing: Listing, intent: SearchIntent, context: ScoreContext): MatchScore {
  if (context.safetyScore != null && (!Number.isFinite(context.safetyScore) || context.safetyScore < 0 || context.safetyScore > 100)) throw new Error('Owner safety score must be between 0 and 100');
  const weights = scoreWeights(intent);
  const rent = intent.criteria.rent;
  const max = rent?.value.max;
  const scores = {
    value: valueScore(context.valuation),
    price: rent && !rent.hard ? max === undefined || listing.monthlyRentCad <= max ? 100 : clamp(100 * (1 - (listing.monthlyRentCad - max) / (max * engineConfig.priceOverrun))) : null,
    travel: travelScore(intent.travelTargets, context.travel, listing.location), home: homeFit(listing, intent),
    safety: intent.safety.enabled && context.safety?.relativeRate != null ? context.safetyScore ?? null : null,
  };
  const sum = (Object.keys(scores) as (keyof typeof scores)[]).reduce((n, key) => n + (scores[key] === null ? 0 : weights[key]), 0);
  const evidence: Record<keyof typeof scores, string[]> = {
    value: [`Comparable asking rents: ${Math.abs(context.valuation.differencePct ?? 0)}% ${(context.valuation.differencePct ?? 0) < 0 ? 'above' : 'below'} estimate; ${context.valuation.comparableCount} comparables; ${context.valuation.confidence} confidence${(context.valuation.differencePct ?? 0) > CAVEATS.farBelowPct ? `; more than ${CAVEATS.farBelowPct}% below is scored neutral (check the listing)` : ''}`],
    price: [`Rent CAD/month ${listing.monthlyRentCad}; preferred range ${rent?.value.min ?? 'unbounded'}–${rent?.value.max ?? 'unbounded'}`],
    home: homeCriteria(listing, intent).filter(c => !c.hard && c.score !== null).map(c => `${c.name}: listing ${JSON.stringify(c.name === 'buildingAge' ? listing.yearBuilt : c.name === 'sizeSqft' ? listing.sqft : c.name === 'availableBy' ? listing.availableFrom : c.name === 'unitTypes' ? { unitType: listing.unitType, bedrooms: listing.bedrooms, rentIsPerRoom: listing.rentIsPerRoom } : listing[c.name as keyof Listing])}; preferred ${JSON.stringify(intent.criteria[c.name as keyof SearchIntent['criteria']]?.value)}; score ${c.score}`),
    travel: intent.travelTargets.flatMap(target => {
      const metres = targetDistanceM(target, context.travel, listing.location);
      return metres === null ? [] : targetModes(target).map(mode => `${target.label}: ${mode}; ${Math.round(metres)} m straight-line distance; estimated ${estimateTravelMinutes(metres, mode)} minutes; budget ${target.maxMinutes ?? defaultMinutes(target, mode)} minutes`);
    }),
    safety: context.safety ? [`Neighbourhood police-reported rate: ${context.safety.relativeRate}× city rate; years ${context.safety.years.join(', ')}; owner-supplied score`] : [],
  };
  const parts = (Object.keys(scores) as (keyof typeof scores)[]).map(id => ({ id, score: scores[id], weight: weights[id], effectiveWeight: scores[id] === null || !sum ? 0 : weights[id] / sum, evidence: scores[id] === null ? [] : evidence[id] }));
  return { total: Math.round(parts.reduce((n, part) => n + (part.score ?? 0) * part.effectiveWeight, 0)), parts, hardFilterNotes: filterListing(listing, intent, context).notes, caveats: [...context.caveats ?? [], ...intent.safety.enabled ? context.safety?.caveats ?? [] : []] };
}
const confidenceRank = { high: 3, medium: 2, low: 1 } as const;
export type TieSide = { listing: Listing; confidence?: keyof typeof confidenceRank | null; valued?: boolean };
/** Fields a listing can actually state. Unknown and blank do not count. */
export function confirmedFieldCount(listing: Listing): number {
  const stated = (value: string | number | null) => value !== null && value !== 'unknown';
  return [listing.bedrooms, listing.bathrooms, listing.sqft, listing.yearBuilt, listing.unitType, listing.airConditioning, listing.petsAllowed, listing.furnished, listing.parking, listing.laundryInSuite, listing.utilitiesIncluded, listing.availableFrom, listing.leaseTerm].filter(stated).length;
}
/** Higher valuation confidence, then more confirmed fields, then newer, then lower rent. */
export function tieBreak(a: TieSide, b: TieSide): number {
  const confidence = (side: TieSide) => side.valued && side.confidence ? confidenceRank[side.confidence] : 0;
  return confidence(b) - confidence(a) || confirmedFieldCount(b.listing) - confirmedFieldCount(a.listing) || Date.parse(b.listing.lastSeenAt) - Date.parse(a.listing.lastSeenAt) || a.listing.monthlyRentCad - b.listing.monthlyRentCad;
}
/** Best match: fewer unconfirmed must-haves, then the score, then tieBreak. A negative result sorts `a` first. */
export function bestMatchOrder(a: { total: number; unconfirmed: number; tie: TieSide }, b: { total: number; unconfirmed: number; tie: TieSide }): number {
  return a.unconfirmed - b.unconfirmed || b.total - a.total || tieBreak(a.tie, b.tie);
}
