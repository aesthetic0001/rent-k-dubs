import { createPlaceSearchHandler } from "@/lib/geo/place-search";
import { poiClient } from "@/lib/geo/poi-client";

export const runtime = "nodejs";
export const GET = createPlaceSearchHandler(fetch, poiClient(process.env.POI_SERVICE_URL)?.resolve);
