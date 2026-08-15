import type { ContactMutationConnection } from './contact-utils';
export interface BirthdayContactIdentity {
    contactId: string | number;
    davUid?: string | null;
    name?: string | null;
    email?: string | null;
}
export declare const MANAGED_BIRTHDAY_CALENDAR_SLUG = "birthdays";
export declare const MANAGED_BIRTHDAY_DTSTAMP = "20000101T000000Z";
export declare function isManagedBirthdayCalendar(calendar: {
    dav_slug?: string | null;
}): boolean;
export declare function isManagedBirthdayEventUid(uid: string): boolean;
export declare function escapeIcalText(value: string): string;
export declare function birthdayEventUid(user: string, identity: BirthdayContactIdentity): string;
export declare function legacyBirthdayEventUid(identity: BirthdayContactIdentity): string | null;
export declare function syncContactBirthdayEvent(connection: ContactMutationConnection, user: string, identity: BirthdayContactIdentity, birthday: string | null, legacyIdentities?: BirthdayContactIdentity[]): Promise<void>;
export declare function rebuildBirthdayCalendarProjectionOnConnection(connection: ContactMutationConnection, user: string): Promise<boolean>;
export declare function repairBirthdayCalendarProjection(user: string): Promise<boolean>;
export declare function repairAllBirthdayCalendarProjections(): Promise<{
    usersChecked: number;
    usersChanged: number;
}>;
//# sourceMappingURL=birthday-calendar.d.ts.map