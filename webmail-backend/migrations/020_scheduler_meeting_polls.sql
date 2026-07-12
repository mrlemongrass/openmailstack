CREATE TABLE IF NOT EXISTS scheduler_meeting_polls (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    owner_username VARCHAR(255) NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('open','finalized','closed') NOT NULL DEFAULT 'open',
    finalized_option_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_poll_token (token_hash),
    KEY idx_scheduler_poll_owner (owner_username, status),
    CONSTRAINT fk_scheduler_poll_event FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_poll_options (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    poll_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    slot_end DATETIME(3) NOT NULL,
    position TINYINT UNSIGNED NOT NULL,
    UNIQUE KEY uniq_scheduler_poll_option_start (poll_id, slot_start),
    CONSTRAINT fk_scheduler_poll_option_poll FOREIGN KEY (poll_id)
        REFERENCES scheduler_meeting_polls (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_poll_votes (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    poll_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    option_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    voter_name VARCHAR(160) NOT NULL,
    voter_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_poll_vote (poll_id, option_id, voter_email),
    CONSTRAINT fk_scheduler_poll_vote_poll FOREIGN KEY (poll_id)
        REFERENCES scheduler_meeting_polls (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_scheduler_poll_vote_option FOREIGN KEY (option_id)
        REFERENCES scheduler_poll_options (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('020_scheduler_meeting_polls');
