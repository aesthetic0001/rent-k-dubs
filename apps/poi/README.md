# Waterloo place search service

The service reads the existing PostgreSQL `pois` table and combines it with the
checked-in Waterloo intersections, campus buildings, stations, and curated aliases.
It indexes the catalogue at startup. Restart it after a civic import to pick up
changes. PostgreSQL still handles nearest-by-category queries for listings.
Apply `pnpm db:migrate` and refresh `pnpm data:civic pois` to import available
street names, civic numbers, cities, and aliases for branch lookup. The refresh
uses municipal place and boundary layers, addresses from containing OSM
buildings, and a verified metadata snapshot. Existing verified metadata is
retained for the same POI when supplemental feeds are unavailable.

The name index supplies source spans to the rental parser. A unique exact alias
resolves directly. Shared aliases return branch choices. Other phrases use the
pinned BGE-base model and the Waterloo prototype's fuzzy name and street boost.
Hybrid candidates require confirmation in the UI.

## Run locally

Set `DATABASE_URL` for the project's migrated database, including `sslmode=require`.
From the repository root, install the service dependencies in a Python 3.12
environment and start it.

```sh
python -m pip install --index-url https://download.pytorch.org/whl/cpu 'torch==2.15.0'
python -m pip install 'numpy==2.5.5' 'transformers==5.24.1' 'psycopg[binary]==3.2.13'
python apps/poi/server.py
```

BGE-base is downloaded to the Hugging Face cache on first startup. Set
`HF_HOME` to reuse a prefilled cache and `HF_HUB_OFFLINE=1` for offline startup.
Set `POI_SERVICE_URL=http://127.0.0.1:8082` on the web app. The parser and map
then use the service, with their existing providers available as fallbacks.
The service binds to loopback by default.

```sh
curl -fsS http://127.0.0.1:8082/health
curl -fsS http://127.0.0.1:8082/mentions -H 'Content-Type: application/json' \
  -d '{"prompt":"Near T&T, within 12 minutes biking to UW"}'
curl -fsS http://127.0.0.1:8082/resolve -H 'Content-Type: application/json' \
  -d '{"query":"T&T"}'
```

## Compose

Set `POI_SERVICE_URL=http://poi:8082` in the root `.env` and run
`docker compose --profile poi up -d --build poi web`. The service is on the
private Compose network. The `poi-models` volume keeps the downloaded model
between container restarts.

POI data from OpenStreetMap is © OpenStreetMap contributors and is available
under the [Open Database License](https://www.openstreetmap.org/copyright).
