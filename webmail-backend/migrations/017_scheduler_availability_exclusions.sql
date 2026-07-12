CREATE TABLE IF NOT EXISTS scheduler_availability_exclusions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    schedule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind ENUM('holiday','out_of_office') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    label VARCHAR(160) NOT NULL DEFAULT '',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_exclusions_schedule_dates (schedule_id, start_date, end_date),
    CONSTRAINT fk_scheduler_exclusion_schedule FOREIGN KEY (schedule_id)
        REFERENCES scheduler_availability_schedules (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT chk_scheduler_exclusion_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('017_scheduler_availability_exclusions');
