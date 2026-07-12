ALTER TABLE scheduler_mailbox_entitlements
    ADD COLUMN IF NOT EXISTS notification_from VARCHAR(255) NULL AFTER default_calendar_id;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('004_scheduler_notification_identity');
