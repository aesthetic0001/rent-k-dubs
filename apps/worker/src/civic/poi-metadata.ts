import { readFileSync } from "node:fs";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { distanceM } from "../pipeline/dedupe.ts";
import { layerUrl, queryAll, WATERLOO_LICENCE, type GeoJsonFeature } from "./lib/arcgis.ts";
import type { Category, OverpassElement, PoiRow } from "./pois.ts";
import type { SourceInput } from "./sources.ts";

type Metadata = Pick<PoiRow, "street_name" | "house_number" | "city" | "aliases">;
type Geometry = z.infer<typeof geometrySchema>;
type Evidence = Partial<Metadata> & {
  kind: "named" | "city" | "building" | "address";
  priority: number;
  name?: string;
  category?: Category;
  geometry: Geometry;
};
type Match = Partial<Metadata> & { id: string; name?: string; priority: number };
type Layer = {
  id: string;
  url: string;
  city?: string;
  name: string;
  street: string;
  number?: string;
  category?: Category;
  priority: number;
};
const kitchener = "https://services1.arcgis.com/qAo1OsXi67t7XgmS/ArcGIS/rest/services/";
const layers: Layer[] = [
  { id: "waterloo-pois-parks", url: layerUrl("Parks"), city: "Waterloo", name: "PARK_NAME", street: "ADDRESS", category: "park", priority: 1 },
  { id: "waterloo-pois-facilities", url: layerUrl("PointsOfInterest"), city: "Waterloo", name: "FACILITY", street: "ADDRESS", priority: 2 },
  { id: "waterloo-pois-recreation", url: layerUrl("RecreationPoints"), city: "Waterloo", name: "NAME", street: "ADDRESS", priority: 2 },
  { id: "waterloo-pois-schools", url: layerUrl("Schools"), city: "Waterloo", name: "NAME", street: "ADDRESS", priority: 2 },
  { id: "waterloo-pois-retail", url: layerUrl("Retail_Business_Directory"), city: "Waterloo", name: "Business_Name", street: "Address_Street", priority: 3 },
  { id: "kitchener-pois-parks", url: kitchener + "Parks/FeatureServer/0", city: "Kitchener", name: "PARK", street: "STREET", number: "CIVIC_NO", category: "park", priority: 1 },
  { id: "kitchener-pois-centres", url: kitchener + "Community_Centres/FeatureServer/0", city: "Kitchener", name: "LANDMARK", street: "STREET", number: "CIVIC_NO", category: "community_centre", priority: 2 },
  { id: "region-pois-municipalities", url: kitchener + "Regional_Municipal_Boundary/FeatureServer/0", name: "MUNICIPALITY", street: "", priority: 5 },
];

const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const nameKey = (name: string) => name.normalize("NFKD").toLowerCase().replace(/\p{M}|['’]/gu, "")
  .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const streetWords: Record<string, string> = {
  street: "st", road: "rd", avenue: "ave", drive: "dr", boulevard: "blvd", court: "ct", crescent: "cres",
  place: "pl", lane: "ln", north: "n", south: "s", east: "e", west: "w",
};
const streetKey = (street: string) => nameKey(street).split(" ").map(word => streetWords[word] ?? word).join(" ");
const parkName = (name: string) => name.replace(/ (?:neighbourhood )?park$/, "");
const singleNumber = /^[1-9]\d*[a-z]?$/i;
const point = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(point).min(4).refine(coords => coords[0]![0] === coords.at(-1)![0] && coords[0]![1] === coords.at(-1)![1]);
const polygon = z.array(ring).min(1);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: point }),
  z.object({ type: z.literal("Polygon"), coordinates: polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1) }),
]);
const snapshotSchema = z.object({
  records: z.array(z.object({
    id: z.string(), name: z.string(), lat: z.number(), lng: z.number(),
    street: z.string().optional(), house_number: z.string().optional(), city: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  })),
});

export function fillPoiMetadata(row: PoiRow, metadata: Partial<Metadata>): void {
  const sameStreet = !row.street_name || !metadata.street_name || streetKey(row.street_name) === streetKey(metadata.street_name);
  const sameNumber = !row.house_number || !metadata.house_number || row.house_number.toLowerCase() === metadata.house_number.toLowerCase();
  if (sameStreet && sameNumber) {
    row.street_name ??= metadata.street_name ?? null;
    row.house_number ??= metadata.house_number ?? null;
  }
  row.city ??= metadata.city ?? null;
  if (!row.aliases.length && metadata.aliases) row.aliases = metadata.aliases;
}

function address(value: string) {
  const match = /^([1-9]\d*[a-z]?(?:\s*-\s*[1-9]\d*[a-z]?)?)\s+([^,;/]+)$/i.exec(value);
  if (!match || !/\b(?:st(?:reet)?|rd|road|ave(?:nue)?|dr(?:ive)?|cres(?:cent)?|ct|court|blvd|boulevard|pl(?:ace)?|lane|ln|way|trail|trl|circle|cir|terrace|terr?|walk|gate|grove|pkwy|parkway|close|run|ridge|line|sideroad|hwy|highway)(?:\s+(?:[nsew]|north|south|east|west))?\.?$/i.test(match[2]!)) return {};
  return { house_number: match[1]!.replace(/\s+/g, ""), street_name: match[2]!.trim() };
}

function municipalEvidence(layer: Layer, feature: GeoJsonFeature): Evidence[] {
  const geo = geometrySchema.safeParse(feature.geometry);
  if (!geo.success) return [];
  const p = feature.properties;
  if (["INACTIVE", "RETIRED"].includes(text(p.STATUS))) return [];
  if (!layer.city) {
    const city = ["Waterloo", "Kitchener", "Cambridge"].find(city => city.toUpperCase() === text(p[layer.name]).toUpperCase());
    return city && geo.data.type !== "Point" ? [{ kind: "city", priority: layer.priority, geometry: geo.data, city }] : [];
  }
  const category = layer.category ?? (p.TYPE === "Park" ? "park" : p.TYPE === "School" ? "school" : undefined);
  const fields = layer.number
    ? { street_name: text(p[layer.street]), house_number: text(p[layer.number]) }
    : address(text(p[layer.street]));
  if (!fields.street_name || !fields.house_number || (layer.number && !singleNumber.test(fields.house_number))) return [];
  const names = new Set([text(p[layer.name]), ...layer.id === "kitchener-pois-parks" ? [text(p.PARK_BOUNDARY_NAME), text(p.MAPLABEL1)] : []]);
  return [...names].filter(name => nameKey(name).length >= 4).map(name => ({
    kind: "named", priority: layer.priority, geometry: geo.data, name, category, city: layer.city, ...fields,
  }));
}

export function poiCoordinates(row: PoiRow) {
  const match = /^SRID=4326;POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/.exec(row.location)!;
  return { lng: Number(match[1]), lat: Number(match[2]) };
}

async function osmBuildings(rows: PoiRow[], fetcher: typeof fetch): Promise<Evidence[]> {
  const centers = [...new Set(rows.filter(row => row.category !== "park" && (!row.street_name || !row.house_number))
    .map(row => { const { lat, lng } = poiCoordinates(row); return `${lat},${lng}`; }))];
  if (!centers.length) return [];
  const ways = centers.map(center => `way(around:55,${center})["building"];`).join("");
  const nodes = centers.map(center => `node(around:55,${center})["addr:street"]["addr:housenumber"];`).join("");
  const response = await fetcher("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "RentTheLoo-civic-loader" },
    body: new URLSearchParams({ data: `[out:json][timeout:15];(${ways});out tags geom;(${nodes});out body;` }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as { remark?: string; elements?: OverpassElement[] } | null;
  if (!data || data.remark || !Array.isArray(data.elements)) throw new Error("Incomplete OSM building response");
  return data.elements.flatMap(element => {
    const tags = element.tags ?? {};
    const street_name = text(tags["addr:street"]);
    const number = text(tags["addr:housenumber"]);
    const house_number = singleNumber.test(number) ? number : null;
    const city = text(tags["addr:city"]) || null;
    const geo = geometrySchema.safeParse(element.type === "way" && tags.building !== "no"
      ? { type: "Polygon", coordinates: [element.geometry?.map(p => [p.lon, p.lat])] }
      : element.type === "node" && street_name && house_number
        ? { type: "Point", coordinates: [element.lon, element.lat] }
        : undefined);
    if (!geo.success) return [];
    return [{ kind: element.type === "way" ? "building" as const : "address" as const,
      priority: 4, geometry: geo.data, street_name, house_number, city }];
  });
}

async function fetchEvidence(rows: PoiRow[], fetcher: typeof fetch) {
  const results = await Promise.allSettled([
    ...layers.map(async layer => {
      const features = await queryAll(layer.url, {
        orderBy: layer.id === "waterloo-pois-retail" ? "objectid" : "OBJECTID", pageSize: 1_000,
      }, async <T>(url: string) => {
        const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
      });
      return features.flatMap(feature => municipalEvidence(layer, feature));
    }),
    osmBuildings(rows, fetcher),
  ]);
  const sources: SourceInput[] = [];
  const evidence: Evidence[] = [];
  for (const [index, result] of results.entries()) {
    const layer = layers[index];
    if (result.status === "rejected") {
      console.warn(`  pois: ${layer?.id ?? "OSM building addresses"} unavailable`);
      continue;
    }
    evidence.push(...result.value);
    if (layer && result.value.length) sources.push({
      id: layer.id, url: layer.url, title: `POI metadata · ${layer.url.split("/").at(-3)}`,
      licence: layer.city === "Waterloo" ? WATERLOO_LICENCE : "Open Government Licence – City of Kitchener",
      note: "Supplemental POI metadata matched by name and geometry or municipal boundary.",
    });
  }
  return { evidence, sources };
}

async function spatialMatches(sql: Sql | TransactionSql, rows: PoiRow[], evidence: Evidence[]): Promise<Match[]> {
  if (!rows.length || !evidence.length) return [];
  const targets = rows.map(row => ({ id: row.id, category: row.category, location: row.location,
    key: row.category === "park" ? parkName(nameKey(row.name)) : nameKey(row.name) }));
  return sql<Match[]>`
    with places as materialized (
      select p.*, ST_GeomFromEWKT(p.location) as geom
      from jsonb_to_recordset(${sql.json(targets)}::jsonb) p(id text, category text, location text, key text)
    ), evidence as materialized (
      select e.*, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(e.geometry), 4326)) as geom
      from jsonb_to_recordset(${sql.json(evidence.map(item => {
        const key = item.name ? nameKey(item.name) : "";
        return { ...item, key, park_key: parkName(key) };
      }))}::jsonb) e(kind text, priority int, name text, category text, key text, park_key text,
        geometry jsonb, street_name text, house_number text, city text)
    ), containing as materialized (
      select p.id, b.geom, b.street_name, b.house_number, b.city
      from places p join evidence b on b.kind = 'building' and ST_Covers(b.geom, p.geom)
      where p.category <> 'park'
    )
    select p.id, e.priority, e.name, e.street_name, e.house_number, e.city
    from places p join evidence e on
      (e.kind = 'city' and ST_Covers(e.geom, p.geom))
      or (e.kind = 'named' and (e.category is null or e.category = p.category)
        and p.key = case when p.category = 'park' then e.park_key else e.key end
        and case when ST_GeometryType(e.geom) = 'ST_Point'
          then ST_DWithin(e.geom::geography, p.geom::geography, case when e.priority = 3 then 45 else 65 end)
          else ST_Covers(e.geom, p.geom) end)
    union all
    select id, 4, null, street_name, house_number, city
    from containing where street_name <> '' and house_number is not null
    union all
    select b.id, 4, null, a.street_name, a.house_number, a.city
    from containing b join evidence a on a.kind = 'address' and ST_Covers(b.geom, a.geom)
  `;
}

export function mergePoiMatches(rows: PoiRow[], matches: Match[], snapshot: z.infer<typeof snapshotSchema>["records"]): void {
  const byId = new Map<string, Match[]>();
  for (const match of matches) {
    const group = byId.get(match.id) ?? [];
    group.push(match);
    byId.set(match.id, group);
  }
  const archived = new Map(snapshot.map(item => [item.id, item]));
  for (const row of rows) {
    const candidates = byId.get(row.id) ?? [];
    const priorities = [...new Set(candidates.map(candidate => candidate.priority))].sort((a, b) => a - b);
    let addressRejected = false;
    for (const priority of priorities) {
      const group = candidates.filter(candidate => candidate.priority === priority);
      const addresses = new Map(group.filter(m => m.street_name && m.house_number)
        .map(m => [`${streetKey(m.street_name!)}:${m.house_number!.toLowerCase()}`, m]));
      const cities = [...new Set(group.map(m => m.city).filter(Boolean))];
      if (cities.length === 1) row.city ??= cities[0]!;
      if (addresses.size > 1) addressRejected = true;
      if (addressRejected || addresses.size !== 1) continue;
      const match = addresses.values().next().value!;
      fillPoiMetadata(row, { street_name: match.street_name, house_number: match.house_number });
      if (match.name && nameKey(match.name) !== nameKey(row.name) && !row.aliases.length)
        row.aliases = [match.name];
    }
    const old = archived.get(row.id);
    if (old && old.name === row.name && distanceM(old, poiCoordinates(row)) < 15) {
      fillPoiMetadata(row, { street_name: addressRejected ? undefined : old.street, house_number: addressRejected ? undefined : old.house_number,
        city: old.city, aliases: old.aliases });
    }
  }
}

export async function enrichPoiRows(sql: Sql, rows: PoiRow[], fetcher: typeof fetch = fetch) {
  const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(
    new URL("../../../../db/seed/poi-metadata-2026-11-25.json", import.meta.url), "utf8")));
  const { evidence, sources } = await fetchEvidence(rows, fetcher);
  const matches = await spatialMatches(sql, rows, evidence);
  mergePoiMatches(rows, matches, snapshot.records);
  return sources;
}
