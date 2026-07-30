import crypto from 'crypto';
import { pool } from './db';
import { serverConfig } from './config';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;

let schemaPromise: Promise<void> | null = null;

const securityKey = () => crypto
    .createHash('sha256')
    .update('openmailstack-account-security\0')
    .update(serverConfig.accountSecurityKey)
    .digest();

const encryptSecret = (value: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', securityKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv, tag: cipher.getAuthTag() };
};

const decryptSecret = (ciphertext: string, iv: Buffer, tag: Buffer): string => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', securityKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
    ]).toString('utf8');
};

const parseHashes = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string' || !value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
};

export const ensureAccountSecuritySchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS account_security (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    totp_secret_ciphertext TEXT NULL,
                    totp_secret_iv VARBINARY(12) NULL,
                    totp_secret_tag VARBINARY(16) NULL,
                    pending_totp_ciphertext TEXT NULL,
                    pending_totp_iv VARBINARY(12) NULL,
                    pending_totp_tag VARBINARY(16) NULL,
                    recovery_code_hashes JSON NULL,
                    totp_enabled_at DATETIME NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS app_passwords (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    label VARCHAR(80) NOT NULL,
                    secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                    prefix VARCHAR(24) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_used_at DATETIME NULL,
                    revoked_at DATETIME NULL,
                    UNIQUE KEY uq_app_password_secret_hash (secret_hash),
                    KEY idx_app_password_owner (username, revoked_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })().then(() => undefined);
    }
    return schemaPromise;
};

export const base32Encode = (input: Buffer): string => {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of input) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
};

const base32Decode = (input: string): Buffer => {
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of input.toUpperCase().replace(/=+$/g, '')) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index < 0) throw new Error('Invalid base32 secret');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
};

export const generateTotp = (
    secret: string,
    timestampMs = Date.now(),
    digits = 6,
): string => {
    const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (
        ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff)
    );
    return String(binary % (10 ** digits)).padStart(digits, '0');
};

export const verifyTotp = (secret: string, code: string, timestampMs = Date.now()): boolean => {
    if (!/^\d{6}$/.test(code)) return false;
    for (const offset of [-1, 0, 1]) {
        const candidate = generateTotp(secret, timestampMs + offset * TOTP_PERIOD_SECONDS * 1000);
        if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return true;
    }
    return false;
};

export const normalizeRecoveryCode = (code: string): string => (
    String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '')
);

export const hashRecoveryCode = (code: string): string => crypto
    .createHash('sha256')
    .update(normalizeRecoveryCode(code))
    .digest('hex');

export const generateAppPassword = (): string => {
    const hex = crypto.randomBytes(16).toString('hex');
    return `oms-${hex.match(/.{1,8}/g)!.join('-')}`;
};

export const hashAppPassword = (password: string): string => crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');

const generateRecoveryCodes = (): string[] => Array.from({ length: 10 }, () => {
    const value = crypto.randomBytes(6).toString('hex');
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
});

export const getAccountSecuritySummary = async (username: string) => {
    await ensureAccountSecuritySchema();
    const [securityRows]: any = await pool.query(
        'SELECT totp_enabled_at FROM account_security WHERE username = ? LIMIT 1',
        [username]
    );
    const [appRows]: any = await pool.query(
        `SELECT id, label, prefix, created_at, last_used_at
         FROM app_passwords
         WHERE username = ? AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [username]
    );
    return {
        twoFactorEnabled: Boolean(securityRows[0]?.totp_enabled_at),
        appPasswords: appRows,
    };
};

export const beginTotpSetup = async (username: string) => {
    await ensureAccountSecuritySchema();
    const secret = base32Encode(crypto.randomBytes(20));
    const encrypted = encryptSecret(secret);
    await pool.query(
        `INSERT INTO account_security
            (username, pending_totp_ciphertext, pending_totp_iv, pending_totp_tag)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            pending_totp_ciphertext = VALUES(pending_totp_ciphertext),
            pending_totp_iv = VALUES(pending_totp_iv),
            pending_totp_tag = VALUES(pending_totp_tag)`,
        [username, encrypted.ciphertext, encrypted.iv, encrypted.tag]
    );
    const label = encodeURIComponent(`OpenMailStack:${username}`);
    return {
        secret,
        provisioningUri: `otpauth://totp/${label}?secret=${secret}&issuer=OpenMailStack&algorithm=SHA1&digits=6&period=30`,
    };
};

export const confirmTotpSetup = async (
    username: string,
    code: string,
    currentSessionHash: string,
) => {
    await ensureAccountSecuritySchema();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows]: any = await connection.query(
            `SELECT pending_totp_ciphertext, pending_totp_iv, pending_totp_tag
             FROM account_security WHERE username = ? LIMIT 1 FOR UPDATE`,
            [username]
        );
        const row = rows[0];
        if (!row?.pending_totp_ciphertext) throw new Error('Two-factor setup has not been started');
        const secret = decryptSecret(row.pending_totp_ciphertext, row.pending_totp_iv, row.pending_totp_tag);
        if (!verifyTotp(secret, String(code || ''))) throw new Error('Invalid authentication code');

        const recoveryCodes = generateRecoveryCodes();
        await connection.query(
            `UPDATE account_security
             SET totp_secret_ciphertext = pending_totp_ciphertext,
                 totp_secret_iv = pending_totp_iv,
                 totp_secret_tag = pending_totp_tag,
                 pending_totp_ciphertext = NULL,
                 pending_totp_iv = NULL,
                 pending_totp_tag = NULL,
                 recovery_code_hashes = ?,
                 totp_enabled_at = NOW()
             WHERE username = ?`,
            [JSON.stringify(recoveryCodes.map(hashRecoveryCode)), username]
        );
        await connection.query(
            'DELETE FROM webmail_sessions WHERE username = ? AND id_hash <> ?',
            [username, currentSessionHash]
        );
        await connection.commit();
        return recoveryCodes;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const verifyAccountSecondFactor = async (
    username: string,
    code: string,
): Promise<boolean> => {
    await ensureAccountSecuritySchema();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows]: any = await connection.query(
            `SELECT totp_secret_ciphertext, totp_secret_iv, totp_secret_tag, recovery_code_hashes
             FROM account_security
             WHERE username = ? AND totp_enabled_at IS NOT NULL
             LIMIT 1
             FOR UPDATE`,
            [username]
        );
        const row = rows[0];
        if (!row?.totp_secret_ciphertext) {
            await connection.commit();
            return false;
        }
        const secret = decryptSecret(row.totp_secret_ciphertext, row.totp_secret_iv, row.totp_secret_tag);
        if (verifyTotp(secret, String(code || ''))) {
            await connection.commit();
            return true;
        }

        const recoveryHashes = parseHashes(row.recovery_code_hashes);
        const suppliedHash = hashRecoveryCode(code);
        const matchIndex = recoveryHashes.findIndex(hash => (
            hash.length === suppliedHash.length
            && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(suppliedHash))
        ));
        if (matchIndex < 0) {
            await connection.commit();
            return false;
        }
        recoveryHashes.splice(matchIndex, 1);
        await connection.query(
            'UPDATE account_security SET recovery_code_hashes = ? WHERE username = ?',
            [JSON.stringify(recoveryHashes), username]
        );
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const isTwoFactorEnabled = async (username: string): Promise<boolean> => {
    await ensureAccountSecuritySchema();
    const [rows]: any = await pool.query(
        'SELECT 1 FROM account_security WHERE username = ? AND totp_enabled_at IS NOT NULL LIMIT 1',
        [username]
    );
    return rows.length > 0;
};

export const disableTwoFactor = async (username: string) => {
    await ensureAccountSecuritySchema();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE account_security
             SET totp_secret_ciphertext = NULL,
                 totp_secret_iv = NULL,
                 totp_secret_tag = NULL,
                 pending_totp_ciphertext = NULL,
                 pending_totp_iv = NULL,
                 pending_totp_tag = NULL,
                 recovery_code_hashes = NULL,
                 totp_enabled_at = NULL
             WHERE username = ?`,
            [username]
        );
        await connection.query(
            'UPDATE app_passwords SET revoked_at = NOW() WHERE username = ? AND revoked_at IS NULL',
            [username]
        );
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const createAppPassword = async (username: string, label: string) => {
    await ensureAccountSecuritySchema();
    const normalizedLabel = String(label || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!normalizedLabel) throw new Error('A device or app name is required');
    const password = generateAppPassword();
    const id = crypto.randomUUID();
    const prefix = `${password.slice(0, 12)}…`;
    const createdAt = new Date().toISOString();
    await pool.query(
        `INSERT INTO app_passwords (id, username, label, secret_hash, prefix)
         VALUES (?, ?, ?, ?, ?)`,
        [id, username, normalizedLabel, hashAppPassword(password), prefix]
    );
    return {
        id,
        label: normalizedLabel,
        prefix,
        password,
        created_at: createdAt,
        last_used_at: null,
    };
};

export const revokeAppPassword = async (username: string, id: string): Promise<boolean> => {
    await ensureAccountSecuritySchema();
    const [result]: any = await pool.query(
        `UPDATE app_passwords SET revoked_at = NOW()
         WHERE id = ? AND username = ? AND revoked_at IS NULL`,
        [id, username]
    );
    return Number(result.affectedRows || 0) === 1;
};
