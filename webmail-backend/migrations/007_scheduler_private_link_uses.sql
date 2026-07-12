ALTER TABLE scheduler_private_links
    ADD COLUMN IF NOT EXISTS max_uses INT UNSIGNED NULL AFTER expires_at,
    ADD COLUMN IF NOT EXISTS uses_remaining INT UNSIGNED NULL AFTER max_uses,
    ADD COLUMN IF NOT EXISTS consumed_at DATETIME(3) NULL AFTER uses_remaining;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('007_scheduler_private_link_uses');
