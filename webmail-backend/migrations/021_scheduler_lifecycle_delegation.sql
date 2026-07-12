ALTER TABLE scheduler_bookings
    MODIFY COLUMN status ENUM('requested','confirmed','cancelled','rejected','completed','no_show') NOT NULL DEFAULT 'confirmed',
    ADD COLUMN IF NOT EXISTS booked_by_username VARCHAR(255) NULL AFTER host_username,
    ADD COLUMN IF NOT EXISTS no_show_at DATETIME(3) NULL AFTER rejected_at;

INSERT IGNORE INTO scheduler_schema_migrations (migration_id)
VALUES ('021_scheduler_lifecycle_delegation');
