psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE rentkdubs_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE rentkdubs TO rentkdubs_app;
GRANT USAGE ON SCHEMA public TO rentkdubs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rentkdubs_app;
SQL
