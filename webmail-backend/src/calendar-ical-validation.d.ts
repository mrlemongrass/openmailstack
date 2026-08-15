export declare const MAX_ICAL_DOCUMENT_BYTES: number;
export declare const MAX_ICAL_RESOURCE_BYTES: number;
export declare const MAX_ICAL_AGGREGATE_RESOURCE_BYTES: number;
export declare const MAX_ICAL_RESOURCE_COMPONENTS = 10000;
export declare const MAX_ICAL_UID_CHARACTERS = 255;
export declare const MAX_ICAL_UID_BYTES: number;
export declare class ICalendarValidationError extends Error {
    constructor(message: string);
}
export interface ICalendarValidationOptions {
    mode?: 'stored-resource' | 'import' | 'subscription';
    allowEmpty?: boolean;
    allowMultipleResourceUids?: boolean;
    allowMultipleResourceTypes?: boolean;
    maxDocumentBytes?: number;
    maxResourceBytes?: number;
    maxAggregateResourceBytes?: number;
    maxResourceComponents?: number;
    maxUidBytes?: number;
}
export interface ValidatedICalendarResource {
    componentType: string;
    uid: string;
    componentCount: number;
    icalData: string;
}
export interface ValidatedICalendarDocument {
    componentTypes: string[];
    supportingComponentTypes: string[];
    unfoldedUids: string[];
    canonicalUid: string | null;
    resources: ValidatedICalendarResource[];
    isEmpty: boolean;
}
export declare function validateICalendarDocument(input: string | Buffer, options?: ICalendarValidationOptions): ValidatedICalendarDocument;
//# sourceMappingURL=calendar-ical-validation.d.ts.map