ALTER TABLE scheduler_event_types
    MODIFY COLUMN visibility ENUM('public', 'unlisted', 'private') NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS scheduler_private_links (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hint CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME(3) NULL,
    revoked_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_private_token (token_hash),
    KEY idx_scheduler_private_event (event_type_id, revoked_at, expires_at),
    CONSTRAINT fk_scheduler_private_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('006_scheduler_private_links');
