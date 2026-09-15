"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAccountOwnedTable = ensureAccountOwnedTable;
const db_1 = require("./db");
// Match the install's existing mailbox collation (legacy installs may use latin1).
// Cascades cover every account-deletion path, including the legacy admin portal.
async function ensureAccountOwnedTable(table) {
    const [columns] = await db_1.pool.query(`SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mailbox' AND COLUMN_NAME = 'username'`);
    const column = columns[0];
    if (!column || !/^[a-z0-9_]+$/.test(column.charset) || !/^[a-z0-9_]+$/.test(column.collation))
        throw new Error('Mailbox ownership schema is unavailable.');
    const [constraints] = await db_1.pool.query(`SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND REFERENCED_TABLE_NAME = 'mailbox' AND DELETE_RULE = 'CASCADE'`, [table, `${table}_account`]);
    if (constraints.length)
        return;
    await db_1.pool.query(`ALTER TABLE ${table} MODIFY owner VARCHAR(255) CHARACTER SET ${column.charset} COLLATE ${column.collation} NOT NULL`);
    await db_1.pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_account FOREIGN KEY (owner) REFERENCES mailbox(username) ON DELETE CASCADE`);
}
//# sourceMappingURL=account-owned-schema.js.map