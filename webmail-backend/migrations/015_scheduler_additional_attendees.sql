ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS max_additional_guests TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER require_email_verification;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS attendees LONGTEXT NULL AFTER booking_answers;

UPDATE scheduler_bookings SET attendees = '[]' WHERE attendees IS NULL;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('015_scheduler_additional_attendees');
