// The nearest place behind a result's trip line ("Est. 2 min walk to groceries"): hovering the line
// pins that grocery store (or park, pharmacy, stop…) on the map. The place comes from the listing's
// nearby lookup (/api/listings/[id]/nearby), the same nearest-first list the listing page shows,
// cached per listing and school level for the visit.
import { create } from "zustand";
import { fetchNearby } from "@/lib/store/actions";
import type { SearchIntent } from "@/lib/store/types";

type Target = SearchIntent["travelTargets"][number];

export interface AmenityPin {
  listingId: string;
  name: string;
  distanceM: number;
  from: { lng: number; lat: number };
  location: { lng: number; lat: number };
}

export const useAmenityPin = create<{ pin: AmenityPin | null }>(() => ({ pin: null }));

const nearby = new Map<string, ReturnType<typeof fetchNearby>>();

/** Only the latest hovered trip may update the pin. */
let pointedAt: symbol | null = null;

export interface NearestPlace {
  name: string;
  distanceM: number;
  location: { lng: number; lat: number };
}

/**
 * The nearest place of `target`'s kind to the listing (its grocery store, park, ION stop…), from
 * the listing's nearby lookup. Null for targets that aren't amenities, or when there's none.
 */
export async function nearestPlace(listingId: string, target: Target | undefined) {
  if (target?.kind !== "amenity" || !target.category) return null;
  const schoolLevel = target.category === "school" && target.schoolLevel !== "any" ? target.schoolLevel : undefined;
  const key = schoolLevel ? `${listingId}:${schoolLevel}` : listingId;
  let lookup = nearby.get(key);
  if (!lookup) {
    lookup = fetchNearby(listingId, { schoolLevel });
    nearby.set(key, lookup);
  }
  const result = await lookup;
  if (!result.ok) {
    nearby.delete(key);
    return null;
  }
  const places = result.nearby;
  const place =
    target.category === "rapid_transit"
      ? places.nearestRapid
      : places.categories.find((group) => group.category === target.category)?.places[0];
  return place
    ? ({ name: place.name, distanceM: place.distanceM, location: place.location } as NearestPlace)
    : null;
}

/** Pin the nearest place of `target`'s kind to the listing. Only amenity targets have one. */
export async function showNearestAmenity(
  listing: { id: string; location: { lng: number; lat: number } },
  target: Target | undefined,
): Promise<void> {
  const hover = Symbol();
  pointedAt = hover;
  const place = await nearestPlace(listing.id, target);
  if (!place || pointedAt !== hover) return;
  useAmenityPin.setState({ pin: { listingId: listing.id, from: listing.location, ...place } });
}

export function clearAmenityPin(): void {
  pointedAt = null;
  useAmenityPin.setState({ pin: null });
}
