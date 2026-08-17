export type OutboundReleaseMode = 'bridge' | 'active';
export type OutboundCompactionMode = 'disabled' | 'registry-verified-v1';
export declare const outboundReleaseMode: OutboundReleaseMode;
export declare const outboundCompactionMode: OutboundCompactionMode;
export declare const serverConfig: {
    host: string;
    port: number;
    publicBaseUrl: string;
    defaultDomain: string;
    sessionTtlMs: number;
    sessionSecret: string;
    accountSecurityKey: string;
    cookieSecure: boolean;
    uploadLimitBytes: number;
    webhookSecret: string;
    notesCollaborationEnabled: boolean;
};
export declare const schedulerConfig: {
    enabled: boolean;
    publicBaseUrl: string;
    allowedHosts: string[];
    notificationFrom: string;
    smtpHost: string;
    smtpPort: number;
    smtpServerName: string;
    smtpRejectUnauthorized: boolean;
    secretKeys: {
        currentVersion: number;
        keys: Record<number, string>;
    };
};
export declare const dbConfig: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
};
export declare const imapConfig: {
    host: string;
    port: number;
    secure: boolean;
    rejectUnauthorized: boolean;
    masterUser: string;
    masterPass: string;
};
export declare const smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    serverName: string;
    rejectUnauthorized: boolean;
    masterUser: string;
    masterPass: string;
};
interface SmtpTransportConfig {
    host: string;
    port: number;
    secure: boolean;
    serverName: string;
    rejectUnauthorized: boolean;
    masterUser?: string;
    masterPass?: string;
}
export declare const smtpTransportOptions: (auth: {
    user: string;
    pass: string;
}, config?: SmtpTransportConfig) => Record<string, unknown>;
export declare const sieveConfig: {
    host: string;
    port: number;
    masterUser: string;
    masterPass: string;
};
export declare const delegatedAuthEnabled: boolean;
export declare const normalizeMailboxUsername: (rawUser: string) => string;
export declare const getPublicBaseUrl: (req: any) => string;
export {};
//# sourceMappingURL=config.d.ts.map