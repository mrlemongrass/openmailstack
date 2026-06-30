export interface ContactRow {
    id: number;
    username: string;
    name: string;
    email: string;
    phone?: string;
    vcard_data?: string;
    dav_uid?: string;
    sync_token?: number;
    updated_at?: string | Date;
    emails_json?: any;
    phones_json?: any;
    addresses_json?: any;
    job_title?: string;
    organization?: string;
    notes?: string;
    labels_json?: any;
    photo_url?: string;
    is_favorite?: number;
    prefix?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    suffix?: string;
    nickname?: string;
    department?: string;
    birthday?: string;
    website_url?: string;
}
export interface ContactLabelRow {
    id: number;
    username: string;
    name: string;
    color: string;
}
export interface ParsedVCardContact {
    name: string;
    email: string;
    phone: string;
    emails?: string[];
    phones?: string[];
    organization?: string;
    title?: string;
    note?: string;
    address?: string;
}
export declare function ensureContactsSchema(): Promise<void>;
export declare function xmlEscape(value: string): string;
export declare function parseVCard(vcard: string): ParsedVCardContact;
export declare function normalizeDavUid(raw: string): string;
export declare function getContactDavUid(contact: ContactRow): string;
export declare function getContactHref(user: string, contact: ContactRow): string;
export declare function normalizeVCardData(vcard: string, davUid: string, fallback: ParsedVCardContact): string;
export declare function patchVCardData(vcard: string, davUid: string, updates: any): string;
export declare function contactEtag(contact: ContactRow): string;
export declare function listContacts(user: string): Promise<ContactRow[]>;
export declare function getContactByDavUid(user: string, davUid: string): Promise<ContactRow | null>;
export declare function saveContactFromVCard(user: string, davUid: string, vcard: string): Promise<{
    contact: ContactRow;
    created: boolean;
}>;
export declare function deleteContactByDavUid(user: string, davUid: string): Promise<boolean>;
export declare function addressBookSyncToken(user: string): Promise<string>;
export declare function contactVCard(contact: ContactRow): string;
//# sourceMappingURL=contact-utils.d.ts.map