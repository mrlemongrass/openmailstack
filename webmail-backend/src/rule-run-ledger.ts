import crypto from 'crypto';
import { pool } from './db';

export interface RuleCopyLedgerAction {
    actionKey: string;
    operationKey: string;
    uid: number;
    destination: string;
}

export interface RuleCopyLedgerReservation {
    token: string;
    ready: Set<string>;
    completed: Set<string>;
    blocked: Set<string>;
    pending: RuleCopyLedgerAction[];
}

export interface RuleCopyLedger {
    pendingForSourceUids(sourceUids: number[]): Promise<RuleCopyLedgerAction[]>;
    reserve(actions: RuleCopyLedgerAction[]): Promise<RuleCopyLedgerReservation>;
    complete(actions: RuleCopyLedgerAction[], token: string): Promise<void>;
    clear(actions: RuleCopyLedgerAction[]): Promise<void>;
    resolvePending(
        operationKey: string,
        actionKeys: string[],
        resolution: 'completed' | 'retry',
    ): Promise<number>;
}

type Queryable = {
    query(sql: string, values?: unknown[]): Promise<any>;
};

let schemaPromise: Promise<void> | null = null;

const ensureSchema = async (db: Queryable) => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db.query(`
                CREATE TABLE IF NOT EXISTS mail_rule_copy_ledger (
                    action_key CHAR(64) NOT NULL PRIMARY KEY,
                    operation_key CHAR(32) NOT NULL,
                    owner VARCHAR(255) NOT NULL,
                    source_folder VARCHAR(512) NOT NULL,
                    source_uidvalidity VARCHAR(64) NOT NULL,
                    source_uid INT UNSIGNED NOT NULL,
                    destination VARCHAR(512) NOT NULL,
                    status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
                    reservation_token CHAR(36) NOT NULL,
                    pending_source_key CHAR(64) NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_rule_copy_pending_source (pending_source_key),
                    KEY idx_rule_copy_owner_source (owner, source_folder(191), source_uidvalidity, source_uid),
                    KEY idx_rule_copy_updated (status, updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })().catch(err => {
            schemaPromise = null;
            throw err;
        });
    }
    await schemaPromise;
};

const chunks = <T>(values: T[], size = 200): T[][] => {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
};

export class RuleRunLedger implements RuleCopyLedger {
    constructor(
        private owner: string,
        private sourceFolder: string,
        private sourceUidValidity: string,
        private db: Queryable = pool,
    ) {}

    async reserve(actions: RuleCopyLedgerAction[]): Promise<RuleCopyLedgerReservation> {
        const token = crypto.randomUUID();
        const reservation: RuleCopyLedgerReservation = {
            token,
            ready: new Set(),
            completed: new Set(),
            blocked: new Set(),
            pending: [],
        };
        if (actions.length === 0) return reservation;

        await ensureSchema(this.db);
        const sourceUids = [...new Set(actions.map(action => action.uid))];
        reservation.pending = await this.pendingForSourceUids(sourceUids);
        reservation.pending.forEach(action => reservation.blocked.add(action.actionKey));
        if (reservation.blocked.size > 0) return reservation;

        for (const batch of chunks(actions)) {
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const values = batch.flatMap(action => [
                action.actionKey,
                action.operationKey,
                this.owner,
                this.sourceFolder,
                this.sourceUidValidity,
                action.uid,
                action.destination,
                token,
                crypto
                    .createHash('sha256')
                    .update(`${this.owner}\0${this.sourceFolder}\0${this.sourceUidValidity}\0${action.uid}`)
                    .digest('hex'),
            ]);
            await this.db.query(
                `INSERT IGNORE INTO mail_rule_copy_ledger
                    (action_key, operation_key, owner, source_folder, source_uidvalidity,
                     source_uid, destination, reservation_token, pending_source_key)
                 VALUES ${placeholders}`,
                values,
            );

            const [rows] = await this.db.query(
                `SELECT action_key, status, reservation_token
                 FROM mail_rule_copy_ledger
                 WHERE action_key IN (${batch.map(() => '?').join(', ')})`,
                batch.map(action => action.actionKey),
            );
            const byKey = new Map(
                (rows as Array<{ action_key: string; status: string; reservation_token: string }>)
                    .map(row => [String(row.action_key), row]),
            );
            for (const action of batch) {
                const row = byKey.get(action.actionKey);
                if (row?.status === 'completed') reservation.completed.add(action.actionKey);
                else if (row?.reservation_token === token) reservation.ready.add(action.actionKey);
                else reservation.blocked.add(action.actionKey);
            }
        }
        if (reservation.blocked.size > 0) {
            await this.db.query(
                `DELETE FROM mail_rule_copy_ledger
                 WHERE reservation_token=? AND status='pending'`,
                [token],
            );
            reservation.ready.clear();
            reservation.pending = await this.pendingForSourceUids(sourceUids);
            reservation.pending.forEach(action => reservation.blocked.add(action.actionKey));
        }
        return reservation;
    }

    async pendingForSourceUids(sourceUids: number[]): Promise<RuleCopyLedgerAction[]> {
        const pending: RuleCopyLedgerAction[] = [];
        if (sourceUids.length === 0) return pending;
        await ensureSchema(this.db);
        for (const batch of chunks([...new Set(sourceUids)])) {
            const [rows] = await this.db.query(
                `SELECT action_key, operation_key, source_uid, destination
                 FROM mail_rule_copy_ledger
                 WHERE owner=? AND source_folder=? AND source_uidvalidity=?
                   AND source_uid IN (${batch.map(() => '?').join(', ')})
                   AND status='pending'`,
                [this.owner, this.sourceFolder, this.sourceUidValidity, ...batch],
            );
            pending.push(...(
                rows as Array<{
                    action_key: string;
                    operation_key: string;
                    source_uid: number;
                    destination: string;
                }>
            ).map(row => ({
                actionKey: String(row.action_key),
                operationKey: String(row.operation_key),
                uid: Number(row.source_uid),
                destination: String(row.destination),
            })));
        }
        return pending;
    }

    async complete(actions: RuleCopyLedgerAction[], token: string): Promise<void> {
        if (actions.length === 0) return;
        await ensureSchema(this.db);
        for (const batch of chunks(actions)) {
            const [result] = await this.db.query(
                `UPDATE mail_rule_copy_ledger
                 SET status='completed', pending_source_key=NULL
                 WHERE reservation_token=? AND action_key IN (${batch.map(() => '?').join(', ')})`,
                [token, ...batch.map(action => action.actionKey)],
            );
            if (Number(result?.affectedRows || 0) !== batch.length) {
                throw new Error('Unable to durably record completed rule copies.');
            }
        }
    }

    async clear(actions: RuleCopyLedgerAction[]): Promise<void> {
        if (actions.length === 0) return;
        await ensureSchema(this.db);
        for (const batch of chunks(actions)) {
            await this.db.query(
                `DELETE FROM mail_rule_copy_ledger
                 WHERE action_key IN (${batch.map(() => '?').join(', ')})`,
                batch.map(action => action.actionKey),
            );
        }
    }

    async resolvePending(
        operationKey: string,
        actionKeys: string[],
        resolution: 'completed' | 'retry',
    ): Promise<number> {
        if (actionKeys.length === 0) return 0;
        await ensureSchema(this.db);
        let affected = 0;
        for (const batch of chunks([...new Set(actionKeys)])) {
            const [result] = resolution === 'completed'
                ? await this.db.query(
                    `UPDATE mail_rule_copy_ledger
                     SET status='completed', pending_source_key=NULL
                     WHERE owner=? AND source_folder=? AND source_uidvalidity=?
                       AND operation_key=? AND status='pending'
                       AND action_key IN (${batch.map(() => '?').join(', ')})`,
                    [this.owner, this.sourceFolder, this.sourceUidValidity, operationKey, ...batch],
                )
                : await this.db.query(
                    `DELETE FROM mail_rule_copy_ledger
                     WHERE owner=? AND source_folder=? AND source_uidvalidity=?
                       AND operation_key=? AND status='pending'
                       AND action_key IN (${batch.map(() => '?').join(', ')})`,
                    [this.owner, this.sourceFolder, this.sourceUidValidity, operationKey, ...batch],
                );
            affected += Number(result?.affectedRows || 0);
        }
        return affected;
    }
}
