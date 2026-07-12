ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS max_recurrence_occurrences TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER waitlist_enabled;

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS series_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attendees,
    ADD COLUMN IF NOT EXISTS series_index TINYINT UNSIGNED NULL AFTER series_id,
    ADD COLUMN IF NOT EXISTS series_count TINYINT UNSIGNED NULL AFTER series_index,
    ADD INDEX IF NOT EXISTS idx_scheduler_booking_series (series_id, series_index);

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('019_scheduler_recurring_bookings');
