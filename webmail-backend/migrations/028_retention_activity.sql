CREATE TABLE IF NOT EXISTS mail_retention (
        owner VARCHAR(255) PRIMARY KEY, revision INT UNSIGNED NOT NULL DEFAULT 0, generation CHAR(36) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 0, options_json TEXT NOT NULL,
        folders_json MEDIUMTEXT NOT NULL, next_run DATETIME NULL,
        last_run DATETIME NULL, status VARCHAR(32) NOT NULL DEFAULT 'off',
        preview_token CHAR(36) NULL, preview_json MEDIUMTEXT NULL, preview_expires DATETIME NULL
    );

CREATE TABLE IF NOT EXISTS mail_retention_seen (
        owner VARCHAR(255) NOT NULL, folder_key CHAR(64) CHARACTER SET ascii NOT NULL,
        uid BIGINT UNSIGNED NOT NULL, first_seen DATETIME(3) NOT NULL,
        PRIMARY KEY (owner, folder_key, uid)
    );

CREATE TABLE IF NOT EXISTS mail_retention_runs (
        id CHAR(36) PRIMARY KEY, owner VARCHAR(255) NOT NULL, state VARCHAR(32) NOT NULL,
        moved INT NOT NULL DEFAULT 0, deleted INT NOT NULL DEFAULT 0,
        junk_days INT NULL, trash_days INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY retention_runs_owner (owner, created_at)
    );

CREATE TABLE IF NOT EXISTS user_activity (
        id CHAR(36) PRIMARY KEY, owner VARCHAR(255) NOT NULL,
        area VARCHAR(16) NOT NULL, action VARCHAR(64) NOT NULL,
        state VARCHAR(24) NOT NULL, recovery_path VARCHAR(128) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY user_activity_owner (owner, created_at)
    );
