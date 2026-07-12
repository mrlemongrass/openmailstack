ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS active_booking_limit SMALLINT UNSIGNED NULL AFTER require_reschedule_reason;

CREATE TABLE IF NOT EXISTS scheduler_booker_locks (
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    booker_email VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (event_type_id, booker_email),
    CONSTRAINT fk_scheduler_booker_lock_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE scheduler_bookings
    ADD INDEX IF NOT EXISTS idx_scheduler_booking_booker_active (event_type_id, booker_email, status, slot_end);

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('012_scheduler_active_booking_limits');
