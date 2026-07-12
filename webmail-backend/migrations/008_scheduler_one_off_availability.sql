ALTER TABLE scheduler_private_links
    ADD COLUMN IF NOT EXISTS one_off_time_zone VARCHAR(64) NULL AFTER consumed_at,
    ADD COLUMN IF NOT EXISTS one_off_windows LONGTEXT NULL AFTER one_off_time_zone;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('008_scheduler_one_off_availability');
