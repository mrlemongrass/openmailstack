export type SettingsNamespace = 'mail' | 'calendar' | 'contacts' | 'appearance';
export interface MailSettings {
    signatures: {
        id: string;
        name: string;
        content: string;
        isDefault?: boolean;
        defaultForNew?: boolean;
        defaultForReply?: boolean;
    }[];
    identity: {
        defaultFrom: string;
        replyTo: string;
        alwaysBccSelf: boolean;
    };
    compose: {
        defaultMode: 'rich' | 'plain';
        defaultFont: 'system' | 'serif' | 'mono';
        attachmentReminder: boolean;
        undoSendSeconds: 0 | 5 | 10 | 20 | 30;
    };
    reading: {
        threaded: boolean;
        density: 'comfortable' | 'cozy' | 'compact';
        previewPane: 'right' | 'bottom' | 'off';
        snippets: boolean;
        externalImages: 'ask' | 'trusted' | 'always';
        markReadDelaySeconds: 0 | 1 | 3 | 5;
    };
    spam: {
        blockedSenders: string[];
        safeSenders: string[];
    };
}
export interface CalendarSettings {
    defaultCalendarId: number | null;
    defaultView: 'day' | 'week' | 'month' | 'year' | 'agenda';
    defaultEventDurationMinutes: number;
    defaultReminderMinutes: 0 | 5 | 10 | 15 | 30 | 60 | 1440;
    weekStartsOn: 0 | 1 | 6;
    timeZone: string;
    clockFormat: '12h' | '24h';
    workingHoursStart: string;
    workingHoursEnd: string;
    visibleDays: number[];
}
export interface ContactsSettings {
    nameFormat: 'firstLast' | 'lastFirst';
    sortBy: 'name' | 'email';
    listDensity: 'comfortable' | 'cozy' | 'compact';
    autoCreateFromSent: boolean;
}
export interface AppearanceSettings {
    themeMode: 'system' | 'dark' | 'light' | 'contrast';
    density: 'comfortable' | 'cozy' | 'compact';
    fontScale: 'small' | 'normal' | 'large';
    radius: 'sharp' | 'soft' | 'round';
    accentColor: 'blue' | 'cyan' | 'green' | 'amber' | 'rose' | 'violet';
    reduceMotion: boolean;
}
export type UserSettings = MailSettings | CalendarSettings | ContactsSettings | AppearanceSettings;
export declare const settingsDefaults: {
    mail: {
        signatures: any[];
        identity: {
            defaultFrom: string;
            replyTo: string;
            alwaysBccSelf: false;
        };
        compose: {
            defaultMode: "rich";
            defaultFont: "system";
            attachmentReminder: true;
            undoSendSeconds: 10;
        };
        reading: {
            threaded: false;
            density: "cozy";
            previewPane: "right";
            snippets: true;
            externalImages: "ask";
            markReadDelaySeconds: 1;
        };
        spam: {
            blockedSenders: any[];
            safeSenders: any[];
        };
    };
    calendar: {
        defaultCalendarId: any;
        defaultView: "month";
        defaultEventDurationMinutes: number;
        defaultReminderMinutes: 10;
        weekStartsOn: 0;
        timeZone: string;
        clockFormat: "12h";
        workingHoursStart: string;
        workingHoursEnd: string;
        visibleDays: number[];
    };
    contacts: {
        nameFormat: "firstLast";
        sortBy: "name";
        listDensity: "cozy";
        autoCreateFromSent: true;
    };
    appearance: {
        themeMode: "dark";
        density: "cozy";
        fontScale: "normal";
        radius: "soft";
        accentColor: "blue";
        reduceMotion: false;
    };
};
export declare function isSettingsNamespace(value: string): value is SettingsNamespace;
export declare function ensureUserSettingsSchema(): Promise<void>;
export declare function normalizeSettings(namespace: SettingsNamespace, value: unknown): UserSettings;
export declare function getUserSettings(username: string, namespace: SettingsNamespace): Promise<UserSettings>;
export declare function saveUserSettings(username: string, namespace: SettingsNamespace, settings: unknown): Promise<UserSettings>;
//# sourceMappingURL=user-settings.d.ts.map