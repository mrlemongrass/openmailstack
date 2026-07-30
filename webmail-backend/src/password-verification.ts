import { spawn } from 'child_process';
import bcrypt from 'bcryptjs';

const DOVECOT_SHA512_CRYPT = /^\{SHA512-CRYPT\}\$6\$(?:rounds=[1-9]\d{3,8}\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$/;
const VERIFY_TIMEOUT_MS = 5_000;

type DovecotVerifier = (password: string, hash: string) => Promise<boolean>;

const verifyDovecotHash: DovecotVerifier = (password, hash) => new Promise((resolve) => {
    if (/[\r\n]/.test(password)) {
        resolve(false);
        return;
    }

    const child = spawn('doveadm', ['pw', '-t', hash], {
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    let settled = false;
    const finish = (verified: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(verified);
    };
    const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(false);
    }, VERIFY_TIMEOUT_MS);

    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0));
    child.stdin.once('error', () => finish(false));
    child.stdin.end(`${password}\n`);
});

export const verifyStoredPassword = async (
    password: unknown,
    storedHash: unknown,
    dovecotVerifier: DovecotVerifier = verifyDovecotHash,
): Promise<boolean> => {
    const candidate = typeof password === 'string' ? password : '';
    const rawHash = typeof storedHash === 'string' ? storedHash : '';
    if (!candidate || candidate.length > 128 || !rawHash) return false;

    const bcryptHash = rawHash.replace(/^\{BLF-CRYPT\}/, '');
    if (/^\$2[aby]\$/.test(bcryptHash)) {
        return bcrypt.compare(candidate, bcryptHash);
    }
    if (DOVECOT_SHA512_CRYPT.test(rawHash)) {
        return dovecotVerifier(candidate, rawHash);
    }
    return false;
};
