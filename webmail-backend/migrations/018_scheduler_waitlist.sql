ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS waitlist_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER max_additional_guests;

CREATE TABLE IF NOT EXISTS scheduler_waitlist_entries (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    desired_start DATETIME(3) NOT NULL,
    desired_end DATETIME(3) NOT NULL,
    status ENUM('pending','promoting','promoted','cancelled','failed') NOT NULL DEFAULT 'pending',
    booker_time_zone VARCHAR(64) NOT NULL,
    booker_name VARCHAR(160) NOT NULL,
    booker_email VARCHAR(255) NOT NULL,
    booker_notes TEXT NULL,
    seats SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    attendees LONGTEXT NULL,
    verified_at DATETIME(3) NULL,
    promoted_booking_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_waitlist_idempotency (tenant_key, idempotency_key),
    KEY idx_scheduler_waitlist_promotion (event_type_id, desired_start, status, created_at),
    CONSTRAINT fk_scheduler_waitlist_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_scheduler_waitlist_booking FOREIGN KEY (promoted_booking_id)
        REFERENCES scheduler_bookings (id) ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('018_scheduler_waitlist');
