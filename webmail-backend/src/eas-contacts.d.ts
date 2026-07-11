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
    photo_url?: string;
}
export declare function activeSyncContactApplicationDataToVCard(davUid: string, applicationData: ActiveSyncNode): string;
export declare function contactToActiveSyncApplicationData(contact: ActiveSyncContactRow, vcard?: string): ActiveSyncNode[];
export {};
//# sourceMappingURL=eas-contacts.d.ts.map