-- Notes can be created by runtime initialization after migrations on a fresh install.
-- Existing deletions were permanent; do not resurrect them in the new Trash view.
SET @notes_exists = (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notes');
SET @notes_trash_new = (SELECT COUNT(*) = 0 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notes' AND column_name = 'is_purged');
SET @notes_trash_sql = IF(@notes_exists > 0, 'ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_purged TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE notes_trash_stmt FROM @notes_trash_sql;
EXECUTE notes_trash_stmt;
DEALLOCATE PREPARE notes_trash_stmt;
SET @notes_trash_sql = IF(@notes_exists > 0 AND @notes_trash_new, 'UPDATE notes SET is_purged = 1 WHERE is_deleted = 1', 'SELECT 1');
PREPARE notes_trash_stmt FROM @notes_trash_sql;
EXECUTE notes_trash_stmt;
DEALLOCATE PREPARE notes_trash_stmt;
