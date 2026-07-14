CREATE TABLE IF NOT EXISTS scheduler_workflows (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    owner_username VARCHAR(255) NOT NULL,
    name VARCHAR(160) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    applies_to_all_event_types TINYINT(1) NOT NULL DEFAULT 1,
    current_version INT UNSIGNED NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_scheduler_workflow_owner (tenant_key, owner_username, enabled),
    CONSTRAINT fk_scheduler_workflow_owner FOREIGN KEY (owner_username)
        REFERENCES scheduler_mailbox_entitlements (username) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_workflow_event_types (
    tenant_key VARCHAR(255) NOT NULL,
    workflow_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (tenant_key, workflow_id, event_type_id),
    CONSTRAINT fk_scheduler_workflow_event_workflow FOREIGN KEY (workflow_id)
        REFERENCES scheduler_workflows (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_scheduler_workflow_event_type FOREIGN KEY (event_type_id)
        REFERENCES scheduler_event_types (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_workflow_versions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    workflow_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT UNSIGNED NOT NULL,
    trigger_type ENUM('booking.start') NOT NULL,
    trigger_offset_seconds INT NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_workflow_version (workflow_id, version),
    KEY idx_scheduler_workflow_version_tenant (tenant_key, workflow_id, version),
    CONSTRAINT fk_scheduler_workflow_version_workflow FOREIGN KEY (workflow_id)
        REFERENCES scheduler_workflows (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_workflow_steps (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    workflow_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    step_order SMALLINT UNSIGNED NOT NULL,
    action_type ENUM('message.email.reminder') NOT NULL,
    delay_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    config LONGTEXT NOT NULL,
    UNIQUE KEY uniq_scheduler_workflow_step_order (workflow_version_id, step_order),
    KEY idx_scheduler_workflow_step_tenant (tenant_key, workflow_version_id, step_order),
    CONSTRAINT fk_scheduler_workflow_step_version FOREIGN KEY (workflow_version_id)
        REFERENCES scheduler_workflow_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_booking_workflow_versions (
    tenant_key VARCHAR(255) NOT NULL,
    booking_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    workflow_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    workflow_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    schedule_generation INT UNSIGNED NOT NULL DEFAULT 1,
    scheduled_start DATETIME(3) NOT NULL,
    captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (tenant_key, booking_id, workflow_id),
    KEY idx_scheduler_booking_workflow_tenant (tenant_key, booking_id),
    KEY idx_scheduler_booking_workflow_version (workflow_version_id),
    CONSTRAINT fk_scheduler_booking_workflow_booking FOREIGN KEY (booking_id)
        REFERENCES scheduler_bookings (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_scheduler_booking_workflow_workflow FOREIGN KEY (workflow_id)
        REFERENCES scheduler_workflows (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_scheduler_booking_workflow_version FOREIGN KEY (workflow_version_id)
        REFERENCES scheduler_workflow_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_jobs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    booking_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    workflow_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    workflow_step_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    schedule_generation INT UNSIGNED NOT NULL DEFAULT 1,
    job_type ENUM('message.email.reminder') NOT NULL,
    idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload LONGTEXT NOT NULL,
    available_at DATETIME(3) NOT NULL,
    lease_owner VARCHAR(128) NULL,
    lease_expires_at DATETIME(3) NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    completed_at DATETIME(3) NULL,
    cancelled_at DATETIME(3) NULL,
    dead_lettered_at DATETIME(3) NULL,
    last_error_code VARCHAR(80) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_job_idempotency (tenant_key, idempotency_key),
    KEY idx_scheduler_job_claim (completed_at, cancelled_at, dead_lettered_at, available_at, lease_expires_at),
    KEY idx_scheduler_job_booking (booking_id, completed_at, cancelled_at),
    CONSTRAINT fk_scheduler_job_booking FOREIGN KEY (booking_id)
        REFERENCES scheduler_bookings (id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_scheduler_job_version FOREIGN KEY (workflow_version_id)
        REFERENCES scheduler_workflow_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_scheduler_job_step FOREIGN KEY (workflow_step_id)
        REFERENCES scheduler_workflow_steps (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_delivery_attempts (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_no SMALLINT UNSIGNED NOT NULL,
    provider VARCHAR(64) NOT NULL,
    outcome ENUM('sending', 'sent', 'retrying', 'dead_lettered') NOT NULL,
    provider_message_id VARCHAR(255) NULL,
    error_code VARCHAR(80) NULL,
    attempted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_delivery_attempt (job_id, attempt_no),
    KEY idx_scheduler_delivery_tenant (tenant_key, attempted_at),
    KEY idx_scheduler_delivery_outcome (outcome, attempted_at),
    CONSTRAINT fk_scheduler_delivery_job FOREIGN KEY (job_id)
        REFERENCES scheduler_jobs (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('024_scheduler_workflow_foundation');
