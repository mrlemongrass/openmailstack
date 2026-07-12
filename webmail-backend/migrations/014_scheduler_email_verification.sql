ALTER TABLE scheduler_event_types
    ADD COLUMN IF NOT EXISTS require_email_verification TINYINT(1) NOT NULL DEFAULT 0 AFTER guest_deny_list;

CREATE TABLE IF NOT EXISTS scheduler_email_verifications (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    booker_email VARCHAR(255) NOT NULL,
    code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_verification_email (event_type_id, booker_email, expires_at),
    CONSTRAINT fk_scheduler_verification_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('014_scheduler_email_verification');
