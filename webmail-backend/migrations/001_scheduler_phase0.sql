CREATE TABLE IF NOT EXISTS scheduler_schema_migrations (
    migration_id VARCHAR(128) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_slot_inventory (
    tenant_key VARCHAR(255) NOT NULL,
    event_type_key VARCHAR(128) NOT NULL,
    host_username VARCHAR(255) NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    slot_end DATETIME(3) NOT NULL,
    capacity INT UNSIGNED NOT NULL,
    held_seats INT UNSIGNED NOT NULL DEFAULT 0,
    confirmed_seats INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (tenant_key, event_type_key, host_username, slot_start),
    UNIQUE KEY uniq_scheduler_inventory_range (tenant_key, event_type_key, host_username, slot_start, slot_end),
    CONSTRAINT chk_scheduler_inventory_capacity CHECK (capacity > 0),
    CONSTRAINT chk_scheduler_inventory_held CHECK (held_seats <= capacity),
    CONSTRAINT chk_scheduler_inventory_confirmed CHECK (confirmed_seats <= capacity),
    CONSTRAINT chk_scheduler_inventory_total CHECK (held_seats + confirmed_seats <= capacity),
    CONSTRAINT chk_scheduler_inventory_range CHECK (slot_end > slot_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduler_slot_holds (
    hold_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    tenant_key VARCHAR(255) NOT NULL,
    event_type_key VARCHAR(128) NOT NULL,
    host_username VARCHAR(255) NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    slot_end DATETIME(3) NOT NULL,
    seats INT UNSIGNED NOT NULL DEFAULT 1,
    status ENUM('held', 'confirmed', 'released', 'expired') NOT NULL DEFAULT 'held',
    expires_at DATETIME(3) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_scheduler_hold_idempotency (tenant_key, idempotency_key),
    KEY idx_scheduler_holds_slot (tenant_key, event_type_key, host_username, slot_start, status),
    KEY idx_scheduler_holds_expiry (status, expires_at),
    CONSTRAINT fk_scheduler_hold_inventory
        FOREIGN KEY (tenant_key, event_type_key, host_username, slot_start, slot_end)
        REFERENCES scheduler_slot_inventory (tenant_key, event_type_key, host_username, slot_start, slot_end)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_scheduler_hold_seats CHECK (seats > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('001_scheduler_phase0');
