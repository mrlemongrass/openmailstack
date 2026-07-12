ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS requires_confirmation TINYINT(1) NOT NULL DEFAULT 0 AFTER booking_questions;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS confirmed_at DATETIME(3) NULL AFTER cancelled_at,
    ADD COLUMN IF NOT EXISTS rejected_at DATETIME(3) NULL AFTER confirmed_at;

UPDATE scheduler_bookings
SET confirmed_at = created_at
WHERE status = 'confirmed' AND confirmed_at IS NULL;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('010_scheduler_host_confirmation');
