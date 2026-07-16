ALTER TABLE scheduler_workflow_versions
    MODIFY COLUMN trigger_type ENUM(
        'booking.requested', 'booking.start', 'booking.ended', 'booking.confirmed',
        'booking.rejected', 'booking.cancelled', 'booking.rescheduled',
        'booking.completed', 'booking.no_show'
    ) NOT NULL;

ALTER TABLE scheduler_workflow_steps
    MODIFY COLUMN action_type ENUM(
        'message.email.reminder', 'message.email', 'notification.in_app',
        'webhook.http', 'message.external'
    ) NOT NULL;

ALTER TABLE scheduler_workflow_steps
    ADD COLUMN IF NOT EXISTS condition_config LONGTEXT NULL AFTER delay_seconds;

ALTER TABLE scheduler_jobs
    MODIFY COLUMN job_type ENUM(
        'message.email.reminder', 'message.email', 'notification.in_app',
        'webhook.http', 'message.external'
    ) NOT NULL;

ALTER TABLE scheduler_jobs
    ADD COLUMN IF NOT EXISTS contact_email VARCHAR(320) NULL AFTER job_type,
    ADD COLUMN IF NOT EXISTS consent_channel ENUM('email', 'sms', 'whatsapp', 'voice') NULL AFTER contact_email,
    ADD INDEX IF NOT EXISTS idx_scheduler_job_consent (tenant_key, contact_email, consent_channel);

ALTER TABLE scheduler_bookings
    ADD COLUMN IF NOT EXISTS booker_phone VARCHAR(32) NULL AFTER booker_email,
    ADD COLUMN IF NOT EXISTS communication_consents LONGTEXT NULL AFTER booker_phone;

ALTER TABLE scheduler_waitlist_entries
    ADD COLUMN IF NOT EXISTS booker_phone VARCHAR(32) NULL AFTER booker_email,
    ADD COLUMN IF NOT EXISTS communication_consents LONGTEXT NULL AFTER booker_phone;

ALTER TABLE scheduler_workflows
    ADD COLUMN IF NOT EXISTS archived_at DATETIME(3) NULL AFTER updated_at;

CREATE TABLE IF NOT EXISTS scheduler_delivery_providers (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    name VARCHAR(120) NOT NULL,
    channel ENUM('webhook', 'sms', 'whatsapp', 'voice', 'translation') NOT NULL,
    endpoint_url VARCHAR(2048) NOT NULL,
    auth_header_name VARCHAR(64) NOT NULL DEFAULT 'Authorization',
    secret_ciphertext TEXT NULL,
    secret_iv VARBINARY(12) NULL,
    secret_tag VARBINARY(16) NULL,
    secret_key_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    timeout_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 15,
    allow_private_network TINYINT(1) NOT NULL DEFAULT 0,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_tested_at DATETIME(3) NULL,
    last_test_status ENUM('healthy', 'failed') NULL,
    last_test_error_code VARCHAR(80) NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_provider_name (tenant_key, name),
    KEY idx_scheduler_provider_channel (tenant_key, channel, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_contact_preferences (
    tenant_key VARCHAR(255) NOT NULL,
    contact_email VARCHAR(320) NOT NULL,
    channel ENUM('email', 'sms', 'whatsapp', 'voice') NOT NULL,
    phone VARCHAR(32) NULL,
    consented_at DATETIME(3) NULL,
    unsubscribed_at DATETIME(3) NULL,
    unsubscribe_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    unsubscribe_token_ciphertext TEXT NOT NULL,
    unsubscribe_token_iv VARBINARY(12) NOT NULL,
    unsubscribe_token_tag VARBINARY(16) NOT NULL,
    unsubscribe_token_key_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (tenant_key, contact_email, channel),
    UNIQUE KEY uniq_scheduler_unsubscribe_token (unsubscribe_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_in_app_notifications (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    recipient_username VARCHAR(255) NOT NULL,
    booking_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    read_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_in_app_idempotency (tenant_key, idempotency_key),
    KEY idx_scheduler_in_app_recipient (recipient_username, read_at, created_at),
    CONSTRAINT fk_scheduler_in_app_booking FOREIGN KEY (booking_id)
        REFERENCES scheduler_bookings (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_delivery_alerts (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    severity ENUM('warning', 'critical') NOT NULL DEFAULT 'warning',
    alert_type ENUM('retrying', 'dead_lettered', 'delivery_uncertain') NOT NULL,
    error_code VARCHAR(80) NULL,
    resolved_at DATETIME(3) NULL,
    resolved_by VARCHAR(255) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_open_alert (job_id, alert_type),
    KEY idx_scheduler_alert_tenant (tenant_key, resolved_at, created_at),
    CONSTRAINT fk_scheduler_alert_job FOREIGN KEY (job_id)
        REFERENCES scheduler_jobs (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('025_scheduler_phase3_completion');
