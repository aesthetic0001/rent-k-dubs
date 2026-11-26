# All-in-one deployment

A push to `main` deploys Caddy, the Next.js web app, PostgreSQL with PostGIS and
TimescaleDB, the rental search extractor, and the POI search service. Caddy is
the only public container. The `scraper` profile is opt-in, and database
migrations run in a separate one-off container without Chromium.

On the VPS, `/srv/rentkdubs/.env` holds `SITE_HOST` and `APP_DB_PASSWORD`. Use
`openssl rand -hex 32` to generate the app password and a separate hex password
in `local/db/owner-password` before creating the database volume. The database
image runs as UID 1000. The owner password must be readable inside the database
and maintenance containers. Keep its parent directory private on the host.

Put a TLS certificate for the Compose hostname `db` at
`local/db/tls/server.crt` and its private key at `local/db/tls/server.key`.
Give the certificate mode `0644` and the private key mode `0600`, owned by UID
1000. The database clients trust this certificate and verify the hostname.

The production workflow uses `VPS_IP` and `VPS_PASSWORD` from the `production`
GitHub environment. To deploy directly on the VPS, run `bash deploy.sh
--production` from the current checkout. The database and model caches live in
named volumes. Keep the database volume and credentials when upgrading.

Listing data comes from a database import or the checked-in demo seed. Model
startup downloads the pinned weights. OpenTripPlanner is deployed separately
using the scripts in `otp/` if routed directions are needed.
