export interface WebmailSession {
    id: string;
    username: string;
    password: string;
    isAdmin: boolean;
    expiresAt: number;
}
export declare const SESSION_COOKIE = "oms_session";
export declare const createSession: (res: any, data: Omit<WebmailSession, "id" | "expiresAt">) => Promise<WebmailSession>;
export declare const getSession: (req: any) => Promise<WebmailSession | null>;
export declare const clearSession: (req: any, res: any) => Promise<void>;
export declare const requireSession: (req: any, res: any, next: any) => Promise<any>;
export declare const requireAdminSession: (req: any, res: any, next: any) => any;
//# sourceMappingURL=auth.d.ts.map