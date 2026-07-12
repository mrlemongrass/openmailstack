ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS public_accent_color VARCHAR(16) NOT NULL DEFAULT '#245fc7' AFTER max_recurrence_occurrences,
    ADD COLUMN IF NOT EXISTS public_intro VARCHAR(500) NOT NULL DEFAULT '' AFTER public_accent_color,
    ADD COLUMN IF NOT EXISTS privacy_url VARCHAR(500) NOT NULL DEFAULT '' AFTER public_intro,
    ADD COLUMN IF NOT EXISTS terms_url VARCHAR(500) NOT NULL DEFAULT '' AFTER privacy_url,
    ADD COLUMN IF NOT EXISTS locale VARCHAR(16) NOT NULL DEFAULT 'en' AFTER terms_url,
    ADD COLUMN IF NOT EXISTS locked_time_zone VARCHAR(64) NULL AFTER locale;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS attribution LONGTEXT NULL AFTER booking_answers;

UPDATE scheduler_bookings SET attribution='{}' WHERE attribution IS NULL;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('022_scheduler_public_distribution');
