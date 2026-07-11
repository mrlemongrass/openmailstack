"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarEventEtag = void 0;
const crypto_1 = __importDefault(require("crypto"));
const normalizeUpdatedAt = (updatedAt) => {
    if (!updatedAt)
        return '';
    if (updatedAt instanceof Date)
        return updatedAt.toISOString();
    return String(updatedAt);
};
const calendarEventEtag = (event) => {
    const hash = crypto_1.default
        .createHash('sha256')
        .update(event.uid || '')
        .update('\0')
        .update(event.ical_data || '')
        .update('\0')
        .update(normalizeUpdatedAt(event.updated_at))
        .digest('hex')
        .slice(0, 24);
    return `"${event.uid}-${hash}"`;
};
exports.calendarEventEtag = calendarEventEtag;
//# sourceMappingURL=dav-etag.js.map