ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS cancellation_cutoff_minutes INT UNSIGNED NULL AFTER requires_confirmation,
    ADD COLUMN IF NOT EXISTS reschedule_cutoff_minutes INT UNSIGNED NULL AFTER cancellation_cutoff_minutes,
    ADD COLUMN IF NOT EXISTS require_cancellation_reason TINYINT(1) NOT NULL DEFAULT 0 AFTER reschedule_cutoff_minutes,
    ADD COLUMN IF NOT EXISTS require_reschedule_reason TINYINT(1) NOT NULL DEFAULT 0 AFTER require_cancellation_reason;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL AFTER rejected_at,
    ADD COLUMN IF NOT EXISTS reschedule_reason TEXT NULL AFTER cancellation_reason;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('011_scheduler_booking_action_policies');
