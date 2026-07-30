"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyStoredPassword = void 0;
const child_process_1 = require("child_process");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const DOVECOT_SHA512_CRYPT = /^\{SHA512-CRYPT\}\$6\$(?:rounds=[1-9]\d{3,8}\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$/;
const VERIFY_TIMEOUT_MS = 5_000;
const verifyDovecotHash = (password, hash) => new Promise((resolve) => {
    if (/[\r\n]/.test(password)) {
        resolve(false);
        return;
    }
    const child = (0, child_process_1.spawn)('doveadm', ['pw', '-t', hash], {
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    let settled = false;
    const finish = (verified) => {
        if (settled)
            return;
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
const verifyStoredPassword = async (password, storedHash, dovecotVerifier = verifyDovecotHash) => {
    const candidate = typeof password === 'string' ? password : '';
    const rawHash = typeof storedHash === 'string' ? storedHash : '';
    if (!candidate || candidate.length > 128 || !rawHash)
        return false;
    const bcryptHash = rawHash.replace(/^\{BLF-CRYPT\}/, '');
    if (/^\$2[aby]\$/.test(bcryptHash)) {
        return bcryptjs_1.default.compare(candidate, bcryptHash);
    }
    if (DOVECOT_SHA512_CRYPT.test(rawHash)) {
        return dovecotVerifier(candidate, rawHash);
    }
    return false;
};
exports.verifyStoredPassword = verifyStoredPassword;
//# sourceMappingURL=password-verification.js.map