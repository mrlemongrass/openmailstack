ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS visibility ENUM('public', 'unlisted') NOT NULL DEFAULT 'public' AFTER system_managed;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('005_scheduler_event_visibility');
