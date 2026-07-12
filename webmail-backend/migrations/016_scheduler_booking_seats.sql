ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS seats SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER status;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('016_scheduler_booking_seats');
