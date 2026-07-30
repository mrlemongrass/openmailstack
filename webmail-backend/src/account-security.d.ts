export declare const ensureAccountSecuritySchema: () => Promise<void>;
export declare const base32Encode: (input: Buffer) => string;
export declare const generateTotp: (secret: string, timestampMs?: number, digits?: number) => string;
export declare const verifyTotp: (secret: string, code: string, timestampMs?: number) => boolean;
export declare const normalizeRecoveryCode: (code: string) => string;
export declare const hashRecoveryCode: (code: string) => string;
export declare const generateAppPassword: () => string;
export declare const hashAppPassword: (password: string) => string;
export declare const getAccountSecuritySummary: (username: string) => Promise<{
    twoFactorEnabled: boolean;
    appPasswords: any;
}>;
export declare const beginTotpSetup: (username: string) => Promise<{
    secret: string;
    provisioningUri: string;
}>;
export declare const confirmTotpSetup: (username: string, code: string, currentSessionHash: string) => Promise<string[]>;
export declare const verifyAccountSecondFactor: (username: string, code: string) => Promise<boolean>;
export declare const isTwoFactorEnabled: (username: string) => Promise<boolean>;
export declare const disableTwoFactor: (username: string) => Promise<void>;
export declare const createAppPassword: (username: string, label: string) => Promise<{
    id: `${string}-${string}-${string}-${string}-${string}`;
    label: string;
    prefix: string;
    password: string;
    created_at: string;
    last_used_at: any;
}>;
export declare const revokeAppPassword: (username: string, id: string) => Promise<boolean>;
//# sourceMappingURL=account-security.d.ts.map