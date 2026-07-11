export function isSyncCollectionReport(body: string): boolean {
    return /<\s*(?:[A-Za-z_][\w.-]*:)?sync-collection(?:\s|>|\/)/i.test(body);
}

export function syncTokenFromReportBody(body: string): string | null {
    const match = body.match(/<\s*(?:[A-Za-z_][\w.-]*:)?sync-token\b[^>]*>([^<]*)<\/\s*(?:[A-Za-z_][\w.-]*:)?sync-token\s*>/i);
    const token = match?.[1]?.trim();
    return token || null;
}
