ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS guest_allow_list LONGTEXT NULL AFTER active_booking_limit,
    ADD COLUMN IF NOT EXISTS guest_deny_list LONGTEXT NULL AFTER guest_allow_list;

UPDATE scheduler_event_types SET guest_allow_list = '[]' WHERE guest_allow_list IS NULL;
UPDATE scheduler_event_types SET guest_deny_list = '[]' WHERE guest_deny_list IS NULL;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('013_scheduler_guest_email_rules');
