ALTER TABLE pois
    ADD COLUMN house_number text,
    ADD COLUMN city text,
    ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb;
