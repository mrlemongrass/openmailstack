CREATE TABLE IF NOT EXISTS scheduler_mailbox_entitlements (
    username VARCHAR(255) NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    public_handle VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    published TINYINT(1) NOT NULL DEFAULT 0,
    display_name VARCHAR(160) NOT NULL DEFAULT '',
    welcome_message TEXT NULL,
    time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    default_calendar_id INT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_public_handle (public_handle),
    KEY idx_scheduler_entitlement_tenant (tenant_key, enabled, published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_event_types (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    owner_username VARCHAR(255) NOT NULL,
    slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    interval_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    buffer_before_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    buffer_after_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    minimum_notice_minutes INT UNSIGNED NOT NULL DEFAULT 60,
    capacity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    location_type ENUM('in_person', 'phone', 'custom', 'conference') NOT NULL DEFAULT 'custom',
    location_label VARCHAR(255) NOT NULL DEFAULT '',
    destination_calendar_id INT NULL,
    conflict_calendar_ids TEXT NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_owner_slug (owner_username, slug),
    KEY idx_scheduler_event_owner (tenant_key, owner_username, active),
    CONSTRAINT chk_scheduler_event_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_scheduler_event_interval CHECK (interval_minutes > 0),
    CONSTRAINT chk_scheduler_event_capacity CHECK (capacity > 0),
    CONSTRAINT fk_scheduler_event_entitlement FOREIGN KEY (owner_username)
        REFERENCES scheduler_mailbox_entitlements (username) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_availability_windows (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL,
    start_minute SMALLINT UNSIGNED NOT NULL,
    end_minute SMALLINT UNSIGNED NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_window_event (event_type_id, weekday, start_minute),
    CONSTRAINT chk_scheduler_window_weekday CHECK (weekday <= 6),
    CONSTRAINT chk_scheduler_window_range CHECK (start_minute < end_minute AND end_minute <= 1440),
    CONSTRAINT fk_scheduler_window_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_bookings (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    host_username VARCHAR(255) NOT NULL,
    status ENUM('requested', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show') NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    slot_end DATETIME(3) NOT NULL,
    host_time_zone VARCHAR(64) NOT NULL,
    booker_time_zone VARCHAR(64) NOT NULL,
    booker_name VARCHAR(160) NOT NULL,
    booker_email VARCHAR(255) NOT NULL,
    booker_notes TEXT NULL,
    event_snapshot TEXT NOT NULL,
    cancel_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reschedule_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action_tokens_expires_at DATETIME(3) NOT NULL,
    slot_hold_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    calendar_id INT NULL,
    calendar_event_uid VARCHAR(255) NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    cancelled_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_booking_idempotency (tenant_key, idempotency_key),
    UNIQUE KEY uniq_scheduler_cancel_token (cancel_token_hash),
    UNIQUE KEY uniq_scheduler_reschedule_token (reschedule_token_hash),
    UNIQUE KEY uniq_scheduler_booking_hold (slot_hold_token),
    KEY idx_scheduler_booking_host (host_username, slot_start, status),
    KEY idx_scheduler_booking_event (event_type_id, slot_start, status),
    CONSTRAINT chk_scheduler_booking_range CHECK (slot_end > slot_start),
    CONSTRAINT fk_scheduler_booking_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_outbox (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(40) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    event_version INT UNSIGNED NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(160) NOT NULL,
    payload LONGTEXT NOT NULL,
    available_at DATETIME(3) NOT NULL,
    lease_owner VARCHAR(128) NULL,
    lease_expires_at DATETIME(3) NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    completed_at DATETIME(3) NULL,
    dead_lettered_at DATETIME(3) NULL,
    last_error_code VARCHAR(80) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_outbox_idempotency (tenant_key, idempotency_key),
    KEY idx_scheduler_outbox_claim (completed_at, dead_lettered_at, available_at, lease_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_audit_events (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    actor_type ENUM('anonymous', 'user', 'admin', 'capability', 'worker') NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(80) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    ip_address VARCHAR(64) NULL,
    metadata LONGTEXT NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    KEY idx_scheduler_audit_tenant_time (tenant_key, occurred_at),
    KEY idx_scheduler_audit_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('002_scheduler_phase1');
