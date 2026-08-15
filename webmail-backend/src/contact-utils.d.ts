import type { PoolConnection } from 'mysql2/promise';
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
export interface ContactMutationMetadata {
    id: number;
    dav_uid: string;
    sync_token: number;
    name: string;
    email: string;
    birthday: string | null;
}
export interface SavedContactMutation {
    contact: ContactMutationMetadata;
    created: boolean;
}
export declare class InvalidContactBirthdayError extends Error {
    constructor();
}
export declare class AmbiguousVCardUidError extends Error {
    constructor();
}
export declare const EAS_CONTACT_SOURCE_COLUMNS: readonly ["dav_uid", "vcard_data", "name", "email", "phone", "emails_json", "phones_json", "addresses_json", "job_title", "organization", "notes", "photo_url", "prefix", "first_name", "middle_name", "last_name", "suffix", "nickname", "department", "birthday", "website_url"];
export declare const easContactSourceBytesExpression: () => string;
export interface ContactLabelRow {
    id: number;
    username: string;
    name: string;
    color: string;
}
export interface ContactTombstoneRow {
    id: number;
    username: string;
    dav_uid: string;
    deleted_at: string | Date;
    sync_token: number;
    contact_id?: number | null;
}
export interface ParsedVCardContact {
    name: string;
    email: string;
    phone: string;
    emails?: string[];
    phones?: string[];
    phoneItems?: ParsedVCardPhone[];
    organization?: string;
    title?: string;
    note?: string;
    address?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    prefix?: string;
    suffix?: string;
    nickname?: string;
    department?: string;
    birthday?: string;
    websiteUrl?: string;
}
export interface ParsedVCardPhone {
    value: string;
    types: string[];
    label: string;
}
export declare function createContactUid(): string;
export declare function contactIdentityRank(contact: Pick<ContactRow, 'dav_uid'>): number;
export declare function ensureContactsSchema(): Promise<void>;
export type ContactMutationConnection = PoolConnection;
export interface ContactMutationLockLease {
    readonly lockName: string;
}
/**
 * Acquire the per-user contact lock on an existing dedicated connection.
 * Composite PIM transactions must acquire their PIM lock first, then this lock,
 * before BEGIN; they must release this lock before the PIM lock after COMMIT or ROLLBACK.
 */
export declare function acquireContactMutationLock(connection: ContactMutationConnection, user: string): Promise<ContactMutationLockLease>;
export declare function releaseContactMutationLock(connection: ContactMutationConnection, lease: ContactMutationLockLease): Promise<void>;
export declare function withContactMutation<T>(user: string, mutate: (connection: ContactMutationConnection) => Promise<T>): Promise<T>;
export declare function xmlEscape(value: string): string;
export declare function stampVCardRevision(vcard: string, date?: Date): string;
export declare function normalizeContactBirthday(value: unknown): string | null;
export declare function extractVCardBirthday(vcard: string): string | null;
export declare function extractVCardUid(vcard: string): string | null;
export declare function parseVCard(vcard: string): ParsedVCardContact;
export declare function normalizeDavUid(raw: string): string;
export declare function getContactDavUid(contact: Pick<ContactRow, 'id' | 'dav_uid'>): string;
export declare function getContactHref(user: string, contact: Pick<ContactRow, 'id' | 'dav_uid'>): string;
export declare function getContactHrefForDavUid(user: string, davUid: string): string;
export declare function normalizeVCardData(vcard: string, davUid: string, fallback: ParsedVCardContact): string;
export declare function patchVCardData(vcard: string, davUid: string, updates: any): string;
export declare function contactEtag(contact: Pick<ContactRow, 'id' | 'dav_uid' | 'sync_token'>): string;
export declare function listContacts(user: string): Promise<ContactRow[]>;
/** @internal Call from an existing contact mutation when a transaction-consistent snapshot is required. */
export declare function listContactsOnConnection(connection: ContactMutationConnection, user: string): Promise<ContactRow[]>;
export declare function listContactsUpdatedSince(user: string, syncToken: number): Promise<ContactRow[]>;
export declare function listContactTombstonesSince(user: string, syncToken: number): Promise<ContactTombstoneRow[]>;
export declare function listRecentContactTombstones(user: string): Promise<ContactTombstoneRow[]>;
export declare function contactTombstoneDavUids(tombstone: ContactTombstoneRow): string[];
export declare function contactSyncTokenVersion(token: string | null | undefined): number;
/** @internal Call only from inside withContactMutation. */
export declare function nextContactSyncTokenOnConnection(connection: ContactMutationConnection, user: string): Promise<number>;
export declare function getContactByDavUid(user: string, davUid: string): Promise<ContactRow | null>;
/** @internal Call only from inside withContactMutation. */
export declare function getContactByDavUidOnConnection(connection: ContactMutationConnection, user: string, davUid: string): Promise<ContactRow | null>;
/** Load the exact identity/version fields needed by a locked contact mutation. */
export declare function getContactMutationMetadataOnConnection(connection: ContactMutationConnection, user: string, davUid: string): Promise<ContactMutationMetadata | null>;
/** Load only the columns covered by the bounded EAS snapshot on its locked connection. */
export declare function getEasContactByDavUidOnConnection(connection: ContactMutationConnection, user: string, davUid: string, expectedSyncToken: number, expectedSourceBytes: number): Promise<ContactRow | null>;
/** @internal Call only from inside withContactMutation. */
export declare function recordContactTombstoneOnConnection(connection: ContactMutationConnection, user: string, davUid: string): Promise<number>;
export declare function recordContactTombstone(user: string, davUid: string): Promise<number>;
/** Resolve only an exact immutable UID stored inside a vCard; never infer identity from mutable fields. */
export declare function findContactDavUidByVCardUidOnConnection(connection: ContactMutationConnection, user: string, vcardUid: string): Promise<string | null>;
/** @internal Call only from inside withContactMutation. */
export declare function saveContactFromVCardOnConnection(connection: ContactMutationConnection, user: string, davUid: string, vcard: string, expectedSyncToken?: number | null): Promise<SavedContactMutation | null>;
export declare function saveContactFromVCard(user: string, davUid: string, vcard: string): Promise<SavedContactMutation>;
export declare function saveContactFromVCard(user: string, davUid: string, vcard: string, expectedSyncToken: number | null): Promise<SavedContactMutation | null>;
/** @internal Call only from inside withContactMutation. */
export declare function deleteContactByDavUidOnConnection(connection: ContactMutationConnection, user: string, davUid: string, expectedSyncToken?: number): Promise<boolean>;
export declare function deleteContactByDavUid(user: string, davUid: string, expectedSyncToken?: number): Promise<boolean>;
export declare function softDeleteContactById(user: string, id: string | number): Promise<boolean>;
export declare function softDeleteContactsByIds(user: string, ids: Array<string | number>): Promise<number>;
export declare function restoreContactById(user: string, id: string | number): Promise<boolean>;
export declare function purgeExpiredContacts(user: string): Promise<number>;
export declare function addressBookSyncToken(user: string): Promise<string>;
export declare function contactVCard(contact: ContactRow): string;
//# sourceMappingURL=contact-utils.d.ts.map