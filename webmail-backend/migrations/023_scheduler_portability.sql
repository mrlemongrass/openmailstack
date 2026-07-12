CREATE TABLE IF NOT EXISTS scheduler_import_runs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    owner_username VARCHAR(255) NOT NULL,
    source ENUM('openmailstack','calendly','calcom') NOT NULL,
    imported_events SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    skipped_events SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_import_owner (owner_username, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('023_scheduler_portability');
