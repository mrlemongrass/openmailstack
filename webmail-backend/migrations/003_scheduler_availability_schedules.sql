CREATE TABLE IF NOT EXISTS scheduler_availability_schedules (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    owner_username VARCHAR(255) NOT NULL,
    name VARCHAR(120) NOT NULL DEFAULT 'Working hours',
    time_zone VARCHAR(64) NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    published TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_schedule_name (owner_username, name),
    KEY idx_scheduler_schedule_owner (tenant_key, owner_username, is_default),
    CONSTRAINT fk_scheduler_schedule_entitlement FOREIGN KEY (owner_username)
        REFERENCES scheduler_mailbox_entitlements (username) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_schedule_windows (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    schedule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL,
    start_minute SMALLINT UNSIGNED NOT NULL,
    end_minute SMALLINT UNSIGNED NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_schedule_window (schedule_id, weekday, start_minute),
    CONSTRAINT fk_scheduler_schedule_window FOREIGN KEY (schedule_id)
        REFERENCES scheduler_availability_schedules (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT chk_scheduler_schedule_window_weekday CHECK (weekday <= 6),
    CONSTRAINT chk_scheduler_schedule_window_range CHECK (start_minute < end_minute AND end_minute <= 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_schedule_overrides (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    schedule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    local_date DATE NOT NULL,
    unavailable_all_day TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_schedule_override_date (schedule_id, local_date),
    CONSTRAINT fk_scheduler_schedule_override FOREIGN KEY (schedule_id)
        REFERENCES scheduler_availability_schedules (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_override_windows (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    override_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    start_minute SMALLINT UNSIGNED NOT NULL,
    end_minute SMALLINT UNSIGNED NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_override_window (override_id, start_minute),
    CONSTRAINT fk_scheduler_override_window FOREIGN KEY (override_id)
        REFERENCES scheduler_schedule_overrides (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT chk_scheduler_override_window_range CHECK (start_minute < end_minute AND end_minute <= 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS availability_schedule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER conflict_calendar_ids,
    ADD COLUMN IF NOT EXISTS system_managed TINYINT(1) NOT NULL DEFAULT 0 AFTER availability_schedule_id;

CREATE INDEX IF NOT EXISTS idx_scheduler_event_schedule
    ON scheduler_event_types (availability_schedule_id, system_managed, active);

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('003_scheduler_availability_schedules');
