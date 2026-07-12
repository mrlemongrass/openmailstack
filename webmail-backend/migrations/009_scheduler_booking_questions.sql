ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS booking_questions LONGTEXT NULL AFTER active;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS booking_answers LONGTEXT NULL AFTER booker_notes;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('009_scheduler_booking_questions');
