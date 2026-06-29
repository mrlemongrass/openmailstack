export type AdminSettingsNamespace = 'organization' | 'publicUrls' | 'security' | 'mailPolicy' | 'system' | 'webhooks';
export interface OrganizationAdminSettings {
    organizationName: string;
    supportEmail: string;
    supportUrl: string;
    defaultLocale: string;
    defaultTimeZone: string;
}
export interface PublicUrlsAdminSettings {
    webmailUrl: string;
    autodiscoverHost: string;
    mailHost: string;
    caldavUrl: string;
    carddavUrl: string;
}
export interface SecurityAdminSettings {
    sessionLifetimeHours: 8 | 12 | 24 | 72 | 168;
    requireSecureCookies: boolean;
    allowUserPasswordChange: boolean;
    showLastLoginNotice: boolean;
}
export interface MailPolicyAdminSettings {
    maxAttachmentMb: number;
    defaultQuotaMb: number;
    spamPolicyMode: 'standard' | 'strict' | 'permissive';
    allowExternalForwarding: boolean;
}
export interface SystemAdminSettings {
    updateChannel: 'stable' | 'preview';
    maintenanceWindow: string;
    telemetryMode: 'off' | 'basic';
    adminNotice: string;
}
export interface WebhooksAdminSettings {
    endpoints: string[];
    events: string[];
}
export type AdminSettings = OrganizationAdminSettings | PublicUrlsAdminSettings | SecurityAdminSettings | MailPolicyAdminSettings | SystemAdminSettings | WebhooksAdminSettings;
export declare const adminSettingsDefaults: {
    organization: {
        organizationName: string;
        supportEmail: string;
        supportUrl: string;
        defaultLocale: string;
        defaultTimeZone: string;
    };
    publicUrls: {
        webmailUrl: string;
        autodiscoverHost: string;
        mailHost: string;
        caldavUrl: string;
        carddavUrl: string;
    };
    security: {
        sessionLifetimeHours: 8;
        requireSecureCookies: true;
        allowUserPasswordChange: false;
        showLastLoginNotice: true;
    };
    mailPolicy: {
        maxAttachmentMb: number;
        defaultQuotaMb: number;
        spamPolicyMode: "standard";
        allowExternalForwarding: true;
    };
    system: {
        updateChannel: "stable";
        maintenanceWindow: string;
        telemetryMode: "off";
        adminNotice: string;
    };
    webhooks: {
        endpoints: any[];
        events: any[];
    };
};
export declare function isAdminSettingsNamespace(value: string): value is AdminSettingsNamespace;
export declare function ensureAdminSettingsSchema(): Promise<void>;
export declare function normalizeAdminSettings(namespace: AdminSettingsNamespace, value: unknown): AdminSettings;
export declare function getAdminSettings(namespace: AdminSettingsNamespace): Promise<AdminSettings>;
export declare function saveAdminSettings(namespace: AdminSettingsNamespace, settings: unknown, updatedBy: string): Promise<AdminSettings>;
//# sourceMappingURL=admin-settings.d.ts.map