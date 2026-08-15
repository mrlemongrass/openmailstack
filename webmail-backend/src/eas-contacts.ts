import { splitEscapedTextList } from './structured-text';

interface ActiveSyncNode {
    tag: string;
    page?: number;
    content?: any;
    children?: ActiveSyncNode[];
}

interface ContactItem {
    value: string;
    label?: string;
    type?: string;
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

export const MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES = 48 * 1024;

export class ActiveSyncContactPictureError extends Error {
    constructor() {
        super('ActiveSync contact picture is invalid or too large');
        this.name = 'ActiveSyncContactPictureError';
    }
}

export class ActiveSyncContactFieldError extends Error {
    constructor() {
        super('ActiveSync contact field is unsupported or too large');
        this.name = 'ActiveSyncContactFieldError';
    }
}

const EMAIL_FIELDS = ['Email1Address', 'Email2Address', 'Email3Address'];
const PHONE_FIELDS = [
    { tag: 'MobilePhoneNumber', type: 'CELL', label: 'Mobile' },
    { tag: 'BusinessPhoneNumber', type: 'WORK', label: 'Work' },
    { tag: 'HomePhoneNumber', type: 'HOME', label: 'Home' },
    { tag: 'Business2PhoneNumber', type: 'WORK', label: 'Work' },
    { tag: 'Home2PhoneNumber', type: 'HOME', label: 'Home' },
    { tag: 'AssistantPhoneNumber', type: 'VOICE', label: 'Assistant' },
    { tag: 'CarPhoneNumber', type: 'CAR', label: 'Car' },
    { tag: 'PagerNumber', type: 'PAGER', label: 'Pager' },
    { tag: 'RadioPhoneNumber', type: 'VOICE', label: 'Radio' },
    { tag: 'BusinessFaxNumber', type: 'FAX,WORK', label: 'Work Fax' },
    { tag: 'HomeFaxNumber', type: 'FAX,HOME', label: 'Home Fax' },
];

const FALLBACK_PHONE_TAGS = [
    'MobilePhoneNumber',
    'BusinessPhoneNumber',
    'HomePhoneNumber',
    'Business2PhoneNumber',
    'Home2PhoneNumber',
    'AssistantPhoneNumber',
    'CarPhoneNumber',
    'PagerNumber',
    'RadioPhoneNumber',
    'BusinessFaxNumber',
    'HomeFaxNumber',
];

const CONTACTS2_PROPERTIES: Record<string, string> = {
    CustomerId: 'X-OMS-CUSTOMER-ID',
    GovernmentId: 'X-OMS-GOVERNMENT-ID',
    ManagerName: 'X-OMS-MANAGER-NAME',
    CompanyMainPhone: 'X-OMS-COMPANY-MAIN-PHONE',
    AccountName: 'X-OMS-ACCOUNT-NAME',
    NickName: 'NICKNAME',
    MMS: 'X-OMS-MMS',
};
const CONTACTS2_IM_FIELDS = ['IMAddress', 'IMAddress2', 'IMAddress3'];
const ADDRESS_FIELDS = {
    Business: { type: 'WORK', tags: ['BusinessAddressStreet', 'BusinessAddressCity', 'BusinessAddressState', 'BusinessAddressPostalCode', 'BusinessAddressCountry'] },
    Home: { type: 'HOME', tags: ['HomeAddressStreet', 'HomeAddressCity', 'HomeAddressState', 'HomeAddressPostalCode', 'HomeAddressCountry'] },
    Other: { type: 'OTHER', tags: ['OtherAddressStreet', 'OtherAddressCity', 'OtherAddressState', 'OtherAddressPostalCode', 'OtherAddressCountry'] },
} as const;
const SUPPORTED_CONTACT_PAGE_ONE = new Set([
    'FileAs', 'FirstName', 'LastName', 'MiddleName', 'Title', 'Suffix',
    ...EMAIL_FIELDS, ...PHONE_FIELDS.map(field => field.tag),
    'CompanyName', 'Department', 'JobTitle', 'Birthday', 'WebPage', 'Picture',
    'Anniversary', 'AssistantName', 'Categories', 'Children', 'OfficeLocation', 'Spouse',
    'YomiCompanyName', 'YomiFirstName', 'YomiLastName',
    ...Object.values(ADDRESS_FIELDS).flatMap(address => [...address.tags]),
]);
const CONTACT_PAGE_ONE_VCARD_PROPERTIES: Record<string, string> = {
    Anniversary: 'ANNIVERSARY',
    AssistantName: 'X-OMS-ASSISTANT-NAME',
    OfficeLocation: 'X-OMS-OFFICE-LOCATION',
    Spouse: 'X-OMS-SPOUSE',
    YomiCompanyName: 'X-OMS-YOMI-COMPANY-NAME',
    YomiFirstName: 'X-OMS-YOMI-FIRST-NAME',
    YomiLastName: 'X-OMS-YOMI-LAST-NAME',
};

function normalizedBirthday(value: string): string | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

const nodeText = (node: ActiveSyncNode | undefined): string => node?.content ? node.content.toString() : '';
const childNode = (node: ActiveSyncNode | undefined, tag: string): ActiveSyncNode | undefined => node?.children?.find(child => child.tag === tag);
const childText = (node: ActiveSyncNode | undefined, tag: string): string => nodeText(childNode(node, tag));
const firstNonEmpty = (...values: string[]): string => values.map(value => value.trim()).find(Boolean) || '';

function vcardEscape(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

function vcardUnescape(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function unfoldVCard(vcard: string): string[] {
    return vcard
        .replace(/\r\n[ \t]/g, '')
        .replace(/\n[ \t]/g, '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean);
}

function vcardPropertyName(line: string): string {
    const raw = line.slice(0, Math.max(0, line.indexOf(':'))).split(';')[0].toUpperCase();
    const dot = raw.lastIndexOf('.');
    return dot >= 0 ? raw.slice(dot + 1) : raw;
}

function vcardPropertyValue(line: string): string {
    const separator = line.indexOf(':');
    return separator >= 0 ? vcardUnescape(line.slice(separator + 1)) : '';
}

function vcardRawPropertyValue(line: string): string {
    const separator = line.indexOf(':');
    return separator >= 0 ? line.slice(separator + 1) : '';
}

function vcardParameterValue(line: string, parameterName: string): string | null {
    const separator = line.indexOf(':');
    const header = separator >= 0 ? line.slice(0, separator) : line;
    for (const parameter of header.split(';').slice(1)) {
        const [name, value] = parameter.split('=', 2);
        if (name.toUpperCase() === parameterName.toUpperCase() && value) return value;
    }
    return null;
}

function vcardEasSlot(line: string, allowed: readonly string[]): string | null {
    const raw = vcardParameterValue(line, 'X-OMS-EAS-SLOT');
    return raw ? allowed.find(slot => slot.toLowerCase() === raw.toLowerCase()) || null : null;
}

function ordinalVCardSlots(lines: string[], allowed: readonly string[]): Map<number, string> {
    const slots = new Map<number, string>();
    const used = new Set<string>();
    lines.forEach((line, index) => {
        const slot = vcardEasSlot(line, allowed);
        if (slot && !used.has(slot)) {
            slots.set(index, slot);
            used.add(slot);
        }
    });
    lines.forEach((_line, index) => {
        if (slots.has(index)) return;
        const slot = allowed.find(candidate => !used.has(candidate));
        if (slot) {
            slots.set(index, slot);
            used.add(slot);
        }
    });
    return slots;
}

const vcardSlottedLine = (property: string, parameters: string[], slot: string, value: string): string =>
    `${property};${[...parameters, `X-OMS-EAS-SLOT=${slot}`].join(';')}:${vcardEscape(value)}`;

function splitEscapedVCardComponents(value: string, count: number): string[] {
    const parts: string[] = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== ';') continue;
        let slashes = 0;
        for (let prior = index - 1; prior >= 0 && value[prior] === '\\'; prior -= 1) slashes += 1;
        if (slashes % 2 === 0) {
            parts.push(vcardUnescape(value.slice(start, index)));
            start = index + 1;
        }
    }
    parts.push(vcardUnescape(value.slice(start)));
    while (parts.length < count) parts.push('');
    return parts.slice(0, count);
}

function replaceVCardProperties(lines: string[], property: string, replacements: string[]): string[] {
    const next = lines.filter(line => vcardPropertyName(line) !== property);
    let endIndex = next.findIndex(line => line.toUpperCase() === 'END:VCARD');
    if (endIndex < 0) {
        next.push('END:VCARD');
        endIndex = next.length - 1;
    }
    next.splice(endIndex, 0, ...replacements);
    return next;
}

function firstVCardProperty(lines: string[], property: string): string {
    const line = lines.find(candidate => vcardPropertyName(candidate) === property);
    return line ? vcardPropertyValue(line) : '';
}

function boundedOutboundText(value: unknown, maxBytes = 8192): string {
    const source = Buffer.from(String(value || '').replace(/\0/g, '\uFFFD'), 'utf8');
    if (source.length <= maxBytes) return source.toString('utf8');
    let end = maxBytes;
    while (end > 0 && (source[end] & 0xC0) === 0x80) end -= 1;
    return source.subarray(0, end).toString('utf8');
}

function assertSupportedContactApplicationData(applicationData: ActiveSyncNode): void {
    const seen = new Set<string>();
    const scalar = (node: ActiveSyncNode, maxBytes: number, multiline = false): boolean =>
        (!node.children || node.children.length === 0)
        && (node.content === undefined || typeof node.content === 'string'
            && Buffer.byteLength(node.content, 'utf8') <= maxBytes
            && !(multiline
                ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
                : /[\u0000-\u001f\u007f]/).test(node.content));
    for (const child of applicationData.children || []) {
        const identity = `${child.page}:${child.tag}`;
        if (seen.has(identity)) throw new ActiveSyncContactFieldError();
        seen.add(identity);
        if (child.page === 17 && child.tag === 'Body') {
            const bodySeen = new Set<string>();
            if (!Array.isArray(child.children) || child.children.length < 1 || child.children.length > 8
                || child.children.some(bodyChild => {
                    if (bodyChild.page !== 17 || bodySeen.has(bodyChild.tag)
                        || !['Type', 'Data', 'EstimatedDataSize', 'Truncated', 'NativeBodyType'].includes(bodyChild.tag)) return true;
                    bodySeen.add(bodyChild.tag);
                    return !scalar(bodyChild, bodyChild.tag === 'Data' ? 60 * 1024 : 16, bodyChild.tag === 'Data');
                })) throw new ActiveSyncContactFieldError();
            const bodyValue = (tag: string) => nodeText(child.children?.find(bodyChild => bodyChild.tag === tag));
            if (bodySeen.has('Type') && bodyValue('Type') !== '1'
                || bodySeen.has('EstimatedDataSize') && !/^(?:0|[1-9][0-9]{0,9})$/.test(bodyValue('EstimatedDataSize'))
                || bodySeen.has('EstimatedDataSize') && Number(bodyValue('EstimatedDataSize')) > 0xFFFFFFFF
                || bodySeen.has('Truncated') && bodyValue('Truncated') !== '0'
                || bodySeen.has('NativeBodyType') && bodyValue('NativeBodyType') !== '1') {
                throw new ActiveSyncContactFieldError();
            }
            continue;
        }
        if (child.page === 1 && (child.tag === 'Categories' || child.tag === 'Children')) {
            const itemTag = child.tag === 'Categories' ? 'Category' : 'Child';
            if (!Array.isArray(child.children) || child.children.length > 128
                || child.tag === 'Categories' && child.children.length === 0
                || child.content !== undefined && child.content !== null
                || child.children.some(item => item.page !== 1 || item.tag !== itemTag || !scalar(item, 255))) {
                throw new ActiveSyncContactFieldError();
            }
            continue;
        }
        if (child.page === 1 && SUPPORTED_CONTACT_PAGE_ONE.has(child.tag)) {
            const maxBytes = PHONE_FIELDS.some(field => field.tag === child.tag) ? 64
                : EMAIL_FIELDS.includes(child.tag) ? 255
                    : child.tag === 'Picture' ? MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES
                        : child.tag === 'WebPage' ? 500
                            : ['FirstName', 'MiddleName', 'LastName'].includes(child.tag) ? 128
                                : ['Title', 'Suffix'].includes(child.tag) ? 32
                                    : child.tag === 'Birthday' ? 32 : 255;
            if (child.tag !== 'Picture' && !scalar(child, maxBytes)) throw new ActiveSyncContactFieldError();
            if (child.tag === 'Birthday' && nodeText(child) && !normalizedBirthday(nodeText(child))) {
                throw new ActiveSyncContactFieldError();
            }
            if (child.tag === 'Anniversary' && nodeText(child) && !normalizedBirthday(nodeText(child))) {
                throw new ActiveSyncContactFieldError();
            }
            continue;
        }
        if (child.page === 12 && (Object.hasOwn(CONTACTS2_PROPERTIES, child.tag) || CONTACTS2_IM_FIELDS.includes(child.tag))) {
            const maxBytes = child.tag === 'NickName' ? 128 : 500;
            if (!scalar(child, maxBytes)) throw new ActiveSyncContactFieldError();
            continue;
        }
        throw new ActiveSyncContactFieldError();
    }
}

function addressComponents(line: string | undefined): string[] {
    return splitEscapedVCardComponents(line ? vcardRawPropertyValue(line) : '', 7);
}

function addressLine(lines: string[], type: string): string | undefined {
    return lines.find(line => {
        if (vcardPropertyName(line) !== 'ADR') return false;
        const header = line.slice(0, line.indexOf(':'));
        return header.split(';').slice(1).some(parameter => {
            const [name, rawValue = ''] = parameter.split('=', 2);
            return name.toUpperCase() === 'TYPE'
                && rawValue.split(',').some(value => value.toUpperCase() === type.toUpperCase());
        });
    });
}

function replaceAddress(lines: string[], type: string, replacement: string | null): string[] {
    const next = lines.filter(line => line !== addressLine(lines, type));
    if (!replacement) return next;
    let endIndex = next.findIndex(line => line.toUpperCase() === 'END:VCARD');
    if (endIndex < 0) endIndex = next.length;
    next.splice(endIndex, 0, replacement);
    return next;
}

function splitVCardComponents(line: string | undefined): string[] {
    return splitEscapedVCardComponents(line ? vcardRawPropertyValue(line) : '', 5);
}

function activeSyncPictureBase64(node: ActiveSyncNode | undefined): string {
    const value = nodeText(node).replace(/\s+/g, '');
    if (!value) return '';
    if (!canonicalPictureBase64(value)) {
        throw new ActiveSyncContactPictureError();
    }
    return value;
}

function canonicalPictureBase64(value: string): boolean {
    if (!value || Buffer.byteLength(value, 'ascii') > MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
}

function pictureBase64FromVCard(vcard: string): string {
    const line = unfoldVCard(vcard).find(candidate => vcardPropertyName(candidate) === 'PHOTO');
    const value = line ? line.slice(line.indexOf(':') + 1).replace(/\s+/g, '') : '';
    return canonicalPictureBase64(value) ? value : '';
}

function noteFromVCard(vcard: string): string {
    const line = unfoldVCard(vcard).find(candidate => vcardPropertyName(candidate) === 'NOTE');
    return line ? vcardPropertyValue(line) : '';
}

function uniqueItems<T extends { value: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
        const key = item.value.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

function splitContactName(name: string): { firstName: string; lastName: string } {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function parseContactItems(raw: any): ContactItem[] {
    let value = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return []; }
    }
    if (!Array.isArray(value)) return [];
    const items: ContactItem[] = [];
    for (const item of value) {
        if (typeof item === 'string') {
            const text = item.trim();
            if (text) items.push({ value: text });
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const text = String(item.value || '').trim();
        if (!text) continue;
        items.push({
            value: text,
            label: typeof item.label === 'string' ? item.label : undefined,
            type: typeof item.type === 'string' ? item.type : undefined,
        });
    }
    return items;
}

function phoneTagForItem(item: ContactItem, usedTags: Set<string>): string | null {
    const label = `${item.label || ''} ${item.type || ''}`.toLowerCase();
    const isFax = label.includes('fax');
    const isWork = label.includes('business') || label.includes('work');
    const isHome = label.includes('home');
    const preferred = isFax && isWork
        ? ['BusinessFaxNumber']
        : isFax && isHome
            ? ['HomeFaxNumber']
            : label.includes('mobile') || label.includes('cell')
        ? ['MobilePhoneNumber']
        : isWork
            ? ['BusinessPhoneNumber', 'Business2PhoneNumber']
            : isHome
                ? ['HomePhoneNumber', 'Home2PhoneNumber']
                : label.includes('assistant')
                    ? ['AssistantPhoneNumber']
                    : label.includes('voice')
                        ? ['AssistantPhoneNumber', 'RadioPhoneNumber']
                    : label.includes('car')
                        ? ['CarPhoneNumber']
                        : label.includes('pager')
                            ? ['PagerNumber']
                            : isFax
                                ? ['BusinessFaxNumber', 'HomeFaxNumber']
                            : [];

    for (const tag of [...preferred, ...FALLBACK_PHONE_TAGS]) {
        if (!usedTags.has(tag)) return tag;
    }
    return null;
}

function collectOutboundEmails(contact: ActiveSyncContactRow): ContactItem[] {
    const parsed = parseContactItems(contact.emails_json);
    const items = contact.email ? [{ value: contact.email, label: 'Primary' }, ...parsed] : parsed;
    return uniqueItems(items.map(item => ({ value: String(item.value || '').trim(), label: item.label }))).slice(0, 3);
}

function collectOutboundPhones(contact: ActiveSyncContactRow): ContactItem[] {
    const parsed = parseContactItems(contact.phones_json);
    const items = contact.phone ? [...parsed, { value: contact.phone, label: 'Primary' }] : parsed;
    return uniqueItems(items.map(item => ({ value: String(item.value || '').trim(), label: item.label, type: item.type }))).slice(0, FALLBACK_PHONE_TAGS.length);
}

function contactApplicationDataWithOmittedClears(
    applicationData: ActiveSyncNode,
    omittedFieldsToClear: ReadonlySet<string>,
): ActiveSyncNode {
    if (omittedFieldsToClear.size === 0) return applicationData;
    const children = [...(applicationData.children || [])];
    const present = new Set(children.map(child => `${child.page}:${child.tag}`));
    for (const identity of omittedFieldsToClear) {
        if (present.has(identity)) continue;
        const separator = identity.indexOf(':');
        const page = Number(identity.slice(0, separator));
        const tag = identity.slice(separator + 1);
        const supported = page === 1 && SUPPORTED_CONTACT_PAGE_ONE.has(tag) && tag !== 'Picture'
            || page === 12 && (Object.hasOwn(CONTACTS2_PROPERTIES, tag) || CONTACTS2_IM_FIELDS.includes(tag));
        if (supported) {
            children.push(page === 1 && (tag === 'Categories' || tag === 'Children')
                ? { tag, page, children: [] }
                : { tag, page, content: '' });
        }
    }
    return { ...applicationData, children };
}

function vcardPhoneBucket(line: string): string | null {
    const separator = line.indexOf(':');
    const parameters = (separator < 0 ? line : line.slice(0, separator)).split(';').slice(1);
    const types = new Set(parameters.flatMap(parameter => {
        const [name, value] = parameter.split('=', 2);
        return (value === undefined ? name : name.toUpperCase() === 'TYPE' ? value : '')
            .split(',').map(type => type.trim().toUpperCase()).filter(Boolean);
    }));
    if (types.has('FAX') && types.has('WORK')) return 'work-fax';
    if (types.has('FAX') && types.has('HOME')) return 'home-fax';
    if (types.has('CELL')) return 'cell';
    if (types.has('CAR')) return 'car';
    if (types.has('PAGER')) return 'pager';
    if (types.has('WORK')) return 'work';
    if (types.has('HOME')) return 'home';
    if (types.has('VOICE')) return 'voice';
    return null;
}

function contactPhoneFieldIdentity(tag: string): string {
    const identities: Record<string, string> = {
        MobilePhoneNumber: 'cell:0',
        BusinessPhoneNumber: 'work:0',
        Business2PhoneNumber: 'work:1',
        HomePhoneNumber: 'home:0',
        Home2PhoneNumber: 'home:1',
        AssistantPhoneNumber: 'voice:0',
        RadioPhoneNumber: 'voice:1',
        CarPhoneNumber: 'car:0',
        PagerNumber: 'pager:0',
        BusinessFaxNumber: 'work-fax:0',
        HomeFaxNumber: 'home-fax:0',
    };
    return identities[tag];
}

function phoneVCardSlots(lines: string[]): Map<number, string> {
    const allowed = PHONE_FIELDS.map(field => field.tag);
    const slots = new Map<number, string>();
    const usedIdentities = new Set<string>();
    lines.forEach((line, index) => {
        const slot = vcardEasSlot(line, allowed);
        const identity = slot ? contactPhoneFieldIdentity(slot) : '';
        if (slot && identity && !usedIdentities.has(identity)) {
            slots.set(index, slot);
            usedIdentities.add(identity);
        }
    });
    const bucketOffsets = new Map<string, number>();
    lines.forEach((line, index) => {
        if (slots.has(index)) return;
        const bucket = vcardPhoneBucket(line);
        if (!bucket) return;
        let offset = bucketOffsets.get(bucket) || 0;
        while (usedIdentities.has(`${bucket}:${offset}`)) offset += 1;
        bucketOffsets.set(bucket, offset + 1);
        const identity = `${bucket}:${offset}`;
        const slot = allowed.find(tag => contactPhoneFieldIdentity(tag) === identity);
        if (slot) {
            slots.set(index, slot);
            usedIdentities.add(identity);
        }
    });
    return slots;
}

export function activeSyncContactApplicationDataToVCard(
    davUid: string,
    applicationData: ActiveSyncNode,
    existingVCard = '',
    omittedFieldsToClear: ReadonlySet<string> = new Set(),
): string {
    assertSupportedContactApplicationData(applicationData);
    applicationData = contactApplicationDataWithOmittedClears(applicationData, omittedFieldsToClear);
    let lines = existingVCard ? unfoldVCard(existingVCard) : [
        'BEGIN:VCARD', 'VERSION:3.0', `UID:${vcardEscape(davUid)}`, 'FN:Unnamed Contact', 'N:;;;;', 'END:VCARD',
    ];
    if (!lines.some(line => vcardPropertyName(line) === 'UID')) {
        lines = replaceVCardProperties(lines, 'UID', [`UID:${vcardEscape(davUid)}`]);
    }

    const firstNameNode = childNode(applicationData, 'FirstName');
    const lastNameNode = childNode(applicationData, 'LastName');
    const middleNameNode = childNode(applicationData, 'MiddleName');
    const titleNode = childNode(applicationData, 'Title');
    const suffixNode = childNode(applicationData, 'Suffix');
    const fileAsNode = childNode(applicationData, 'FileAs');
    if (firstNameNode || lastNameNode || middleNameNode || titleNode || suffixNode || fileAsNode || !existingVCard) {
        const existingNLine = lines.find(line => vcardPropertyName(line) === 'N');
        const nameParts = splitVCardComponents(existingNLine);
        if (lastNameNode) nameParts[0] = nodeText(lastNameNode);
        if (firstNameNode) nameParts[1] = nodeText(firstNameNode);
        if (middleNameNode) nameParts[2] = nodeText(middleNameNode);
        if (titleNode) nameParts[3] = nodeText(titleNode);
        if (suffixNode) nameParts[4] = nodeText(suffixNode);
        lines = replaceVCardProperties(lines, 'N', [`N:${nameParts.map(vcardEscape).join(';')}`]);
        if (fileAsNode || firstNameNode || lastNameNode || !existingVCard) {
            const currentFn = vcardPropertyValue(lines.find(line => vcardPropertyName(line) === 'FN') || '');
            const displayName = fileAsNode
                ? nodeText(fileAsNode)
                : firstNonEmpty([nameParts[1], nameParts[0]].filter(Boolean).join(' '), currentFn, 'Unnamed Contact');
            lines = replaceVCardProperties(lines, 'FN', [`FN:${vcardEscape(displayName || 'Unnamed Contact')}`]);
        }
    }

    const existingEmails = lines.filter(line => vcardPropertyName(line) === 'EMAIL');
    if (EMAIL_FIELDS.some(tag => childNode(applicationData, tag))) {
        const assigned = ordinalVCardSlots(existingEmails, EMAIL_FIELDS);
        const applied = new Set<string>();
        const nextEmails = existingEmails.flatMap((line, index) => {
            const slot = assigned.get(index);
            const node = slot ? childNode(applicationData, slot) : undefined;
            if (!slot || !node) return [line];
            applied.add(slot);
            const value = nodeText(node);
            return value ? [vcardSlottedLine('EMAIL', ['TYPE=INTERNET'], slot, value)] : [];
        });
        for (const tag of EMAIL_FIELDS) {
            const node = childNode(applicationData, tag);
            if (node && !applied.has(tag) && nodeText(node)) {
                nextEmails.push(vcardSlottedLine('EMAIL', ['TYPE=INTERNET'], tag, nodeText(node)));
            }
        }
        lines = replaceVCardProperties(lines, 'EMAIL', nextEmails);
    }

    const existingPhones = lines.filter(line => vcardPropertyName(line) === 'TEL');
    if (PHONE_FIELDS.some(field => childNode(applicationData, field.tag))) {
        const incoming = new Map<string, { field: typeof PHONE_FIELDS[number]; value: string }>();
        for (const field of PHONE_FIELDS) {
            const node = childNode(applicationData, field.tag);
            if (node) incoming.set(contactPhoneFieldIdentity(field.tag), { field, value: nodeText(node) });
        }
        const assigned = phoneVCardSlots(existingPhones);
        const applied = new Set<string>();
        const nextPhones = existingPhones.flatMap((line, index) => {
            const slot = assigned.get(index);
            const identity = slot ? contactPhoneFieldIdentity(slot) : '';
            const update = incoming.get(identity);
            if (!update) return [line];
            applied.add(identity);
            return update.value
                ? [vcardSlottedLine('TEL', [`TYPE=${update.field.type}`], update.field.tag, update.value)]
                : [];
        });
        for (const [identity, update] of incoming) {
            if (!applied.has(identity) && update.value) {
                nextPhones.push(vcardSlottedLine('TEL', [`TYPE=${update.field.type}`], update.field.tag, update.value));
            }
        }
        lines = replaceVCardProperties(lines, 'TEL', nextPhones);
    }

    const companyNode = childNode(applicationData, 'CompanyName');
    const departmentNode = childNode(applicationData, 'Department');
    if (companyNode || departmentNode) {
        const org = splitVCardComponents(lines.find(line => vcardPropertyName(line) === 'ORG'));
        if (companyNode) org[0] = nodeText(companyNode);
        if (departmentNode) org[1] = nodeText(departmentNode);
        const used = org.slice(0, 2);
        lines = replaceVCardProperties(lines, 'ORG', used.some(Boolean) ? [`ORG:${used.map(vcardEscape).join(';')}`] : []);
    }
    for (const [tag, property] of [['JobTitle', 'TITLE'], ['Birthday', 'BDAY'], ['WebPage', 'URL']] as const) {
        const node = childNode(applicationData, tag);
        if (node) {
            const raw = nodeText(node);
            const value = tag === 'Birthday' && raw ? normalizedBirthday(raw)! : raw;
            lines = replaceVCardProperties(lines, property, value ? [`${property}:${vcardEscape(value)}`] : []);
        }
    }
    for (const [tag, property] of Object.entries(CONTACT_PAGE_ONE_VCARD_PROPERTIES)) {
        const node = childNode(applicationData, tag);
        if (!node) continue;
        const raw = nodeText(node);
        const value = tag === 'Anniversary' && raw ? normalizedBirthday(raw)! : raw;
        lines = replaceVCardProperties(lines, property, value ? [`${property}:${vcardEscape(value)}`] : []);
    }
    const categoriesNode = childNode(applicationData, 'Categories');
    if (categoriesNode) {
        lines = replaceVCardProperties(lines, 'CATEGORIES', (categoriesNode.children || [])
            .map(category => nodeText(category))
            .filter(Boolean)
            .map(category => `CATEGORIES:${vcardEscape(category)}`));
    }
    const childrenNode = childNode(applicationData, 'Children');
    if (childrenNode) {
        lines = replaceVCardProperties(lines, 'X-OMS-CHILD', (childrenNode.children || [])
            .map(child => nodeText(child))
            .filter(Boolean)
            .map(child => `X-OMS-CHILD:${vcardEscape(child)}`));
    }
    for (const address of Object.values(ADDRESS_FIELDS)) {
        if (!address.tags.some(tag => childNode(applicationData, tag))) continue;
        const prior = addressComponents(addressLine(lines, address.type));
        const indexes = [2, 3, 4, 5, 6];
        address.tags.forEach((tag, index) => {
            const node = childNode(applicationData, tag);
            if (node) prior[indexes[index]] = nodeText(node);
        });
        lines = replaceAddress(lines, address.type, prior.some(Boolean)
            ? `ADR;TYPE=${address.type}:${prior.map(vcardEscape).join(';')}` : null);
    }
    for (const [tag, property] of Object.entries(CONTACTS2_PROPERTIES)) {
        const node = childNode(applicationData, tag);
        if (node) lines = replaceVCardProperties(lines, property, nodeText(node) ? [`${property}:${vcardEscape(nodeText(node))}`] : []);
    }
    if (CONTACTS2_IM_FIELDS.some(tag => childNode(applicationData, tag))) {
        const impp = lines.filter(line => vcardPropertyName(line) === 'IMPP');
        const assigned = ordinalVCardSlots(impp, CONTACTS2_IM_FIELDS);
        const applied = new Set<string>();
        const nextImpp = impp.flatMap((line, index) => {
            const slot = assigned.get(index);
            const node = slot ? childNode(applicationData, slot) : undefined;
            if (!slot || !node) return [line];
            applied.add(slot);
            return nodeText(node) ? [vcardSlottedLine('IMPP', [], slot, nodeText(node))] : [];
        });
        for (const tag of CONTACTS2_IM_FIELDS) {
            const node = childNode(applicationData, tag);
            if (node && !applied.has(tag) && nodeText(node)) {
                nextImpp.push(vcardSlottedLine('IMPP', [], tag, nodeText(node)));
            }
        }
        lines = replaceVCardProperties(lines, 'IMPP', nextImpp);
    }
    const body = childNode(applicationData, 'Body');
    if (body) {
        const note = childText(body, 'Data');
        lines = replaceVCardProperties(lines, 'NOTE', note ? [`NOTE:${vcardEscape(note)}`] : []);
    }
    const pictureNode = childNode(applicationData, 'Picture');
    if (pictureNode) {
        const picture = activeSyncPictureBase64(pictureNode);
        lines = replaceVCardProperties(
            lines,
            'PHOTO',
            picture ? [`PHOTO;ENCODING=BASE64;TYPE=JPEG:${picture}`] : [],
        );
    }

    return `${lines.join('\r\n')}\r\n`;
}

export function contactToActiveSyncApplicationData(contact: ActiveSyncContactRow, vcard = contact.vcard_data || ''): ActiveSyncNode[] {
    const lines = unfoldVCard(vcard);
    const fileAs = boundedOutboundText(contact.name || contact.email || 'Unnamed Contact');
    const structuredName = splitVCardComponents(lines.find(line => vcardPropertyName(line) === 'N'));
    const splitName = splitContactName(contact.name || '');
    const firstName = boundedOutboundText(structuredName[1] || splitName.firstName);
    const lastName = boundedOutboundText(structuredName[0] || splitName.lastName);
    const data: ActiveSyncNode[] = [
        { tag: 'FileAs', page: 1, content: fileAs }
    ];

    if (firstName) data.push({ tag: 'FirstName', page: 1, content: firstName });
    if (lastName) data.push({ tag: 'LastName', page: 1, content: lastName });
    if (structuredName[2]) data.push({ tag: 'MiddleName', page: 1, content: boundedOutboundText(structuredName[2]) });
    if (structuredName[3]) data.push({ tag: 'Title', page: 1, content: boundedOutboundText(structuredName[3]) });
    if (structuredName[4]) data.push({ tag: 'Suffix', page: 1, content: boundedOutboundText(structuredName[4]) });

    const emailValues = new Map<string, string>();
    const emailLines = lines.filter(line => vcardPropertyName(line) === 'EMAIL');
    const emailSlots = ordinalVCardSlots(emailLines, EMAIL_FIELDS);
    emailLines.forEach((line, index) => {
        const slot = emailSlots.get(index);
        const value = vcardPropertyValue(line).trim();
        if (slot && value && !emailValues.has(slot)) emailValues.set(slot, value);
    });
    const usedEmailValues = new Set([...emailValues.values()].map(value => value.toLowerCase()));
    for (const email of collectOutboundEmails(contact)) {
        if (usedEmailValues.has(email.value.toLowerCase())) continue;
        const slot = EMAIL_FIELDS.find(tag => !emailValues.has(tag));
        if (!slot) break;
        emailValues.set(slot, email.value);
        usedEmailValues.add(email.value.toLowerCase());
    }
    for (const tag of EMAIL_FIELDS) {
        const value = emailValues.get(tag);
        if (value) data.push({ tag, page: 1, content: boundedOutboundText(value, 255) });
    }

    const phoneValues = new Map<string, string>();
    const phoneLines = lines.filter(line => vcardPropertyName(line) === 'TEL');
    const phoneSlots = phoneVCardSlots(phoneLines);
    phoneLines.forEach((line, index) => {
        const slot = phoneSlots.get(index);
        const value = vcardPropertyValue(line).trim();
        if (slot && value && !phoneValues.has(slot)) phoneValues.set(slot, value);
    });
    const usedPhoneTags = new Set(phoneValues.keys());
    const usedPhoneValues = new Set([...phoneValues.values()].map(value => value.toLowerCase()));
    for (const phone of collectOutboundPhones(contact)) {
        if (usedPhoneValues.has(phone.value.toLowerCase())) continue;
        const tag = phoneTagForItem(phone, usedPhoneTags);
        if (!tag) continue;
        usedPhoneTags.add(tag);
        phoneValues.set(tag, phone.value);
        usedPhoneValues.add(phone.value.toLowerCase());
    }
    for (const tag of FALLBACK_PHONE_TAGS) {
        const value = phoneValues.get(tag);
        if (value) data.push({ tag, page: 1, content: boundedOutboundText(value, 64) });
    }

    const org = splitVCardComponents(lines.find(line => vcardPropertyName(line) === 'ORG'));
    const company = contact.organization || org[0];
    const department = contact.department || org[1];
    if (company) data.push({ tag: 'CompanyName', page: 1, content: boundedOutboundText(company) });
    if (department) data.push({ tag: 'Department', page: 1, content: boundedOutboundText(department) });
    if (contact.job_title || firstVCardProperty(lines, 'TITLE')) data.push({ tag: 'JobTitle', page: 1, content: boundedOutboundText(contact.job_title || firstVCardProperty(lines, 'TITLE')) });
    const birthday = contact.birthday || firstVCardProperty(lines, 'BDAY');
    if (birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
        data.push({ tag: 'Birthday', page: 1, content: `${birthday}T00:00:00.000Z` });
    }
    if (contact.website_url || firstVCardProperty(lines, 'URL')) data.push({ tag: 'WebPage', page: 1, content: boundedOutboundText(contact.website_url || firstVCardProperty(lines, 'URL'), 500) });
    for (const [tag, property] of Object.entries(CONTACT_PAGE_ONE_VCARD_PROPERTIES)) {
        const value = firstVCardProperty(lines, property);
        if (!value) continue;
        data.push({
            tag,
            page: 1,
            content: tag === 'Anniversary' && /^\d{4}-\d{2}-\d{2}$/.test(value)
                ? `${value}T00:00:00.000Z`
                : boundedOutboundText(value, 255),
        });
    }
    const categoryValues = lines.filter(line => vcardPropertyName(line) === 'CATEGORIES')
        .flatMap(line => splitEscapedTextList(vcardRawPropertyValue(line)).map(vcardUnescape))
        .filter(Boolean).slice(0, 128);
    if (categoryValues.length) {
        data.push({ tag: 'Categories', page: 1, children: categoryValues.map(value => ({
            tag: 'Category', page: 1, content: boundedOutboundText(value, 255),
        })) });
    }
    const childValues = lines.filter(line => vcardPropertyName(line) === 'X-OMS-CHILD')
        .map(vcardPropertyValue).filter(Boolean).slice(0, 128);
    if (childValues.length) {
        data.push({ tag: 'Children', page: 1, children: childValues.map(value => ({
            tag: 'Child', page: 1, content: boundedOutboundText(value, 255),
        })) });
    }
    for (const address of Object.values(ADDRESS_FIELDS)) {
        const values = addressComponents(addressLine(lines, address.type));
        const indexes = [2, 3, 4, 5, 6];
        address.tags.forEach((tag, index) => {
            if (values[indexes[index]]) data.push({ tag, page: 1, content: boundedOutboundText(values[indexes[index]]) });
        });
    }
    for (const [tag, property] of Object.entries(CONTACTS2_PROPERTIES)) {
        const value = tag === 'NickName' ? contact.nickname || firstVCardProperty(lines, property) : firstVCardProperty(lines, property);
        if (value) data.push({ tag, page: 12, content: boundedOutboundText(value, 500) });
    }
    const imppLines = lines.filter(line => vcardPropertyName(line) === 'IMPP');
    const imppSlots = ordinalVCardSlots(imppLines, CONTACTS2_IM_FIELDS);
    imppLines.forEach((line, index) => {
        const slot = imppSlots.get(index);
        if (slot && vcardPropertyValue(line)) {
            data.push({ tag: slot, page: 12, content: boundedOutboundText(vcardPropertyValue(line), 500) });
        }
    });
    const picture = contact.photo_url?.startsWith('data:image/')
        ? contact.photo_url.replace(/^data:image\/[^;]+;base64,/, '')
        : pictureBase64FromVCard(vcard);
    if (canonicalPictureBase64(picture)) data.push({ tag: 'Picture', page: 1, content: picture });

    const notes = contact.notes || noteFromVCard(vcard);
    if (notes) {
        const safeNotes = boundedOutboundText(notes, 60 * 1024);
        data.push({
            tag: 'Body',
            page: 17,
            children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: safeNotes },
                { tag: 'EstimatedDataSize', page: 17, content: Buffer.byteLength(String(notes), 'utf8').toString() }
            ]
        });
    }

    return data;
}
