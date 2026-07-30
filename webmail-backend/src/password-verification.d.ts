type DovecotVerifier = (password: string, hash: string) => Promise<boolean>;
export declare const verifyStoredPassword: (password: unknown, storedHash: unknown, dovecotVerifier?: DovecotVerifier) => Promise<boolean>;
export {};
//# sourceMappingURL=password-verification.d.ts.map