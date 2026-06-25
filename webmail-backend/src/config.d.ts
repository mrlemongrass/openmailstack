export declare const serverConfig: {
    host: string;
    port: number;
    publicBaseUrl: string;
    defaultDomain: string;
    sessionTtlMs: number;
    sessionSecret: string;
    cookieSecure: boolean;
    uploadLimitBytes: number;
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
};
export declare const smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    rejectUnauthorized: boolean;
};
export declare const sieveConfig: {
    host: string;
    port: number;
};
export declare const normalizeMailboxUsername: (rawUser: string) => string;
export declare const getPublicBaseUrl: (req: any) => string;
//# sourceMappingURL=config.d.ts.map