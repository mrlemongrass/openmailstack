import { type ContactMutationConnection } from './contact-utils';
export declare class ContactGroupError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export declare function isGroupVCard(vcard: string): boolean;
export declare function hasVCardCategories(vcard: string): boolean;
export declare function validateContactGroupName(value: unknown): string;
export declare function vCardCategories(vcard: string): string[];
export declare function setVCardCategories(vcard: string, categories: string[]): string;
export declare function foldVCardCategoryLines(vcard: string): string;
export declare function reconcileContactGroups(user: string, apply?: boolean): Promise<{
    contactsChecked: any;
    contactsToReconcile: number;
    applied: boolean;
}>;
export declare function syncContactCategoryMemberships(connection: ContactMutationConnection, user: string, contactId: number, categories: string[]): Promise<void>;
export declare function projectContactGroupCategories(connection: ContactMutationConnection, user: string, contactIds: number[]): Promise<number>;
export declare function createContactGroup(user: string, rawName: unknown, color?: unknown): Promise<number>;
export declare function updateContactGroup(user: string, rawId: unknown, updates: {
    name?: unknown;
    color?: unknown;
} | null): Promise<void>;
export declare function changeContactGroupMembers(user: string, rawId: unknown, rawContactIds: unknown, remove?: boolean): Promise<number>;
//# sourceMappingURL=contact-groups.d.ts.map