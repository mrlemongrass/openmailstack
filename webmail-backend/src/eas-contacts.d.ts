interface ActiveSyncNode {
    tag: string;
    page?: number;
    content?: any;
    children?: ActiveSyncNode[];
}
interface ActiveSyncContactRow {
    name?: string;
    email?: string;
    phone?: string;
    emails_json?: any;
    phones_json?: any;
    organization?: string;
    job_title?: string;
    nickname?: string;
    department?: string;
    birthday?: string;
    website_url?: string;
    notes?: string;
    photo_url?: string;
    vcard_data?: string;
}
export declare const MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES: number;
export declare class ActiveSyncContactPictureError extends Error {
    constructor();
}
export declare class ActiveSyncContactFieldError extends Error {
    constructor();
}
export declare function activeSyncContactApplicationDataToVCard(davUid: string, applicationData: ActiveSyncNode, existingVCard?: string, omittedFieldsToClear?: ReadonlySet<string>): string;
export declare function contactToActiveSyncApplicationData(contact: ActiveSyncContactRow, vcard?: string): ActiveSyncNode[];
export {};
//# sourceMappingURL=eas-contacts.d.ts.map