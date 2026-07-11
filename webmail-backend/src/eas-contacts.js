"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeSyncContactApplicationDataToVCard = activeSyncContactApplicationDataToVCard;
exports.contactToActiveSyncApplicationData = contactToActiveSyncApplicationData;
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
];
const nodeText = (node) => node?.content ? node.content.toString() : '';
const childNode = (node, tag) => node?.children?.find(child => child.tag === tag);
const childText = (node, tag) => nodeText(childNode(node, tag));
const firstNonEmpty = (...values) => values.map(value => value.trim()).find(Boolean) || '';
function vcardEscape(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}
function uniqueItems(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = item.value.trim().toLowerCase();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}
function splitContactName(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1)
        return { firstName: parts[0] || '', lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
function parseContactItems(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(value))
        return [];
    const items = [];
    for (const item of value) {
        if (typeof item === 'string') {
            const text = item.trim();
            if (text)
                items.push({ value: text });
            continue;
        }
        if (!item || typeof item !== 'object')
            continue;
        const text = String(item.value || '').trim();
        if (!text)
            continue;
        items.push({
            value: text,
            label: typeof item.label === 'string' ? item.label : undefined,
            type: typeof item.type === 'string' ? item.type : undefined,
        });
    }
    return items;
}
function phoneTagForItem(item, usedTags) {
    const label = `${item.label || ''} ${item.type || ''}`.toLowerCase();
    const preferred = label.includes('mobile') || label.includes('cell')
        ? ['MobilePhoneNumber']
        : label.includes('business') || label.includes('work')
            ? ['BusinessPhoneNumber', 'Business2PhoneNumber']
            : label.includes('home')
                ? ['HomePhoneNumber', 'Home2PhoneNumber']
                : label.includes('assistant')
                    ? ['AssistantPhoneNumber']
                    : label.includes('car')
                        ? ['CarPhoneNumber']
                        : label.includes('pager')
                            ? ['PagerNumber']
                            : [];
    for (const tag of [...preferred, ...FALLBACK_PHONE_TAGS]) {
        if (!usedTags.has(tag))
            return tag;
    }
    return null;
}
function collectOutboundEmails(contact) {
    const parsed = parseContactItems(contact.emails_json);
    const items = contact.email ? [{ value: contact.email, label: 'Primary' }, ...parsed] : parsed;
    return uniqueItems(items.map(item => ({ value: String(item.value || '').trim(), label: item.label }))).slice(0, 3);
}
function collectOutboundPhones(contact) {
    const parsed = parseContactItems(contact.phones_json);
    const items = contact.phone ? [...parsed, { value: contact.phone, label: 'Primary' }] : parsed;
    return uniqueItems(items.map(item => ({ value: String(item.value || '').trim(), label: item.label, type: item.type }))).slice(0, FALLBACK_PHONE_TAGS.length);
}
function activeSyncContactApplicationDataToVCard(davUid, applicationData) {
    const firstName = childText(applicationData, 'FirstName');
    const lastName = childText(applicationData, 'LastName');
    const fileAs = childText(applicationData, 'FileAs');
    const emails = uniqueItems(EMAIL_FIELDS
        .map((tag, index) => ({ value: childText(applicationData, tag), label: index === 0 ? 'Primary' : 'Other' }))
        .filter(item => item.value.trim()));
    const phones = uniqueItems(PHONE_FIELDS
        .map(field => ({ value: childText(applicationData, field.tag), label: field.label, type: field.type }))
        .filter(item => item.value.trim()));
    const company = childText(applicationData, 'CompanyName');
    const jobTitle = childText(applicationData, 'JobTitle');
    const displayName = firstNonEmpty([firstName, lastName].filter(Boolean).join(' '), fileAs, emails[0]?.value || '', 'Unnamed Contact');
    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `UID:${vcardEscape(davUid)}`,
        `FN:${vcardEscape(displayName)}`,
        `N:${vcardEscape(lastName)};${vcardEscape(firstName)};;;`
    ];
    for (const email of emails) {
        lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(email.value)}`);
    }
    for (const phone of phones) {
        lines.push(`TEL;TYPE=${phone.type || 'VOICE'}:${vcardEscape(phone.value)}`);
    }
    if (company)
        lines.push(`ORG:${vcardEscape(company)}`);
    if (jobTitle)
        lines.push(`TITLE:${vcardEscape(jobTitle)}`);
    const picture = childText(applicationData, 'Picture');
    if (picture && picture.startsWith('data:image/')) {
        const b64 = picture.replace(/^data:image\/[^;]+;base64,/, '');
        lines.push(`PHOTO;ENCODING=BASE64;TYPE=JPEG:${b64}`);
    }
    lines.push('END:VCARD');
    return `${lines.join('\r\n')}\r\n`;
}
function contactToActiveSyncApplicationData(contact, vcard = '') {
    const fileAs = contact.name || contact.email || 'Unnamed Contact';
    const { firstName, lastName } = splitContactName(contact.name || '');
    const data = [
        { tag: 'FileAs', page: 1, content: fileAs }
    ];
    if (firstName)
        data.push({ tag: 'FirstName', page: 1, content: firstName });
    if (lastName)
        data.push({ tag: 'LastName', page: 1, content: lastName });
    const emails = collectOutboundEmails(contact);
    emails.forEach((item, index) => {
        const tag = EMAIL_FIELDS[index];
        if (tag)
            data.push({ tag, page: 1, content: item.value });
    });
    const usedPhoneTags = new Set();
    for (const phone of collectOutboundPhones(contact)) {
        const tag = phoneTagForItem(phone, usedPhoneTags);
        if (!tag)
            continue;
        usedPhoneTags.add(tag);
        data.push({ tag, page: 1, content: phone.value });
    }
    if (contact.organization)
        data.push({ tag: 'CompanyName', page: 1, content: contact.organization });
    if (contact.job_title)
        data.push({ tag: 'JobTitle', page: 1, content: contact.job_title });
    if (contact.photo_url && contact.photo_url.startsWith('data:image/')) {
        data.push({ tag: 'Picture', page: 1, content: contact.photo_url });
    }
    if (vcard) {
        data.push({
            tag: 'Body',
            page: 17,
            children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: vcard },
                { tag: 'EstimatedDataSize', page: 17, content: vcard.length.toString() }
            ]
        });
    }
    return data;
}
//# sourceMappingURL=eas-contacts.js.map