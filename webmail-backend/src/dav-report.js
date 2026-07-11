"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSyncCollectionReport = isSyncCollectionReport;
exports.syncTokenFromReportBody = syncTokenFromReportBody;
function isSyncCollectionReport(body) {
    return /<\s*(?:[A-Za-z_][\w.-]*:)?sync-collection(?:\s|>|\/)/i.test(body);
}
function syncTokenFromReportBody(body) {
    const match = body.match(/<\s*(?:[A-Za-z_][\w.-]*:)?sync-token\b[^>]*>([^<]*)<\/\s*(?:[A-Za-z_][\w.-]*:)?sync-token\s*>/i);
    const token = match?.[1]?.trim();
    return token || null;
}
//# sourceMappingURL=dav-report.js.map