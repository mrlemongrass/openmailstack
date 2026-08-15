"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCalendarSubscriptionWorker = exports.runCalendarSubscriptionFetchOnce = exports.ensureCalendarSubscriptionSchema = exports.MAX_CALENDAR_SUBSCRIPTION_EVENTS = exports.MAX_CALENDAR_SUBSCRIPTION_RUN_MS = exports.MAX_CALENDAR_SUBSCRIPTIONS_PER_RUN = void 0;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const calendar_utils_1 = require("./calendar-utils");
const calendar_subscription_http_1 = require("./calendar-subscription-http");
const calendar_ical_validation_1 = require("./calendar-ical-validation");
exports.MAX_CALENDAR_SUBSCRIPTIONS_PER_RUN = 20;
exports.MAX_CALENDAR_SUBSCRIPTION_RUN_MS = 2 * 60 * 1000;
exports.MAX_CALENDAR_SUBSCRIPTION_EVENTS = 1_000;
const defaultWorkerDependencies = {
    fetchSubscription: calendar_subscription_http_1.fetchCalendarSubscription,
    now: Date.now,
};
let schemaPromise = null;
async function readSubscriptionSchemaColumns() {
    const [columns] = await db_1.pool.query(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         AND (
            (TABLE_NAME = 'calendars' AND COLUMN_NAME IN ('last_fetched_at', 'last_fetch_error'))
            OR (TABLE_NAME = 'events' AND COLUMN_NAME = 'subscription_managed')
         )`);
    return new Map(columns.map(column => ([`${String(column.TABLE_NAME).toLowerCase()}.${String(column.COLUMN_NAME).toLowerCase()}`, column])));
}
const ensureCalendarSubscriptionSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const existing = await readSubscriptionSchemaColumns();
            if (!existing.has('calendars.last_fetched_at')) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN last_fetched_at DATETIME NULL AFTER subscribed_url');
            }
            if (!existing.has('calendars.last_fetch_error')) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN last_fetch_error TEXT NULL AFTER last_fetched_at');
            }
            if (!existing.has('events.subscription_managed')) {
                await db_1.pool.query('ALTER TABLE events ADD COLUMN subscription_managed TINYINT(1) NOT NULL DEFAULT 0 AFTER sync_token');
            }
            const verified = await readSubscriptionSchemaColumns();
            const missing = [
                'calendars.last_fetched_at',
                'calendars.last_fetch_error',
                'events.subscription_managed',
            ].filter(column => !verified.has(column));
            if (missing.length > 0) {
                throw new Error(`Calendar subscription schema is missing required columns: ${missing.join(', ')}`);
            }
            const lastFetchedAt = verified.get('calendars.last_fetched_at');
            if (!/^(?:datetime|timestamp)$/i.test(String(lastFetchedAt.DATA_TYPE))
                || String(lastFetchedAt.IS_NULLABLE).toUpperCase() !== 'YES') {
                throw new Error('Calendar subscription schema column calendars.last_fetched_at is incompatible');
            }
            const lastFetchError = verified.get('calendars.last_fetch_error');
            if (!/^(?:text|mediumtext|longtext)$/i.test(String(lastFetchError.DATA_TYPE))
                || String(lastFetchError.IS_NULLABLE).toUpperCase() !== 'YES') {
                throw new Error('Calendar subscription schema column calendars.last_fetch_error is incompatible');
            }
            const subscriptionManaged = verified.get('events.subscription_managed');
            if (String(subscriptionManaged.DATA_TYPE).toLowerCase() !== 'tinyint'
                || String(subscriptionManaged.IS_NULLABLE).toUpperCase() !== 'NO'
                || String(subscriptionManaged.COLUMN_DEFAULT ?? '') !== '0') {
                throw new Error('Calendar subscription schema column events.subscription_managed is incompatible');
            }
        })().catch(error => {
            schemaPromise = null;
            throw error;
        });
    }
    return schemaPromise;
};
exports.ensureCalendarSubscriptionSchema = ensureCalendarSubscriptionSchema;
function subscriptionLockName(calendarId) {
    const identity = (0, crypto_1.createHash)('sha256').update(String(calendarId)).digest('hex').slice(0, 40);
    return `oms-calendar-sub-${identity}`;
}
function safeSubscriptionError(error, subscribedUrl) {
    const message = error instanceof Error ? error.message : 'Calendar subscription synchronization failed';
    const withoutExactUrl = subscribedUrl
        ? message.replaceAll(subscribedUrl, '[redacted subscription URL]')
        : message;
    return withoutExactUrl
        .replace(/https?:\/\/[^\s"')]+/gi, '[redacted subscription URL]')
        .slice(0, 500);
}
function assertSubscriptionRunBudget(now, deadline) {
    if (now() >= deadline)
        throw new Error('Calendar subscription run deadline exceeded');
}
function normalizedLegacySingleEventBlock(icalData, expectedUid) {
    if (Buffer.byteLength(icalData, 'utf8') > calendar_ical_validation_1.MAX_ICAL_RESOURCE_BYTES)
        return null;
    const physicalLines = icalData.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const lines = [];
    for (const line of physicalLines) {
        if (line.startsWith(' ') || line.startsWith('\t')) {
            if (lines.length === 0)
                return null;
            lines[lines.length - 1] += line.slice(1);
        }
        else {
            lines.push(line);
        }
    }
    const stack = [];
    const eventBlocks = [];
    let currentTopLevelType = '';
    let currentTopLevelLines = null;
    let rootSeen = false;
    let rootClosed = false;
    for (const line of lines) {
        const separator = line.indexOf(':');
        const marker = separator > 0 ? line.slice(0, separator).toUpperCase() : '';
        const componentType = separator > 0 ? line.slice(separator + 1).toUpperCase() : '';
        if (marker === 'BEGIN') {
            if (stack.length === 0) {
                if (rootSeen || rootClosed || componentType !== 'VCALENDAR')
                    return null;
                rootSeen = true;
            }
            else if (stack.length === 1) {
                if (componentType !== 'VEVENT' && componentType !== 'VTIMEZONE')
                    return null;
                currentTopLevelType = componentType;
                currentTopLevelLines = [line];
            }
            else {
                currentTopLevelLines?.push(line);
            }
            stack.push(componentType);
            continue;
        }
        if (marker === 'END') {
            if (stack.length === 0 || stack[stack.length - 1] !== componentType)
                return null;
            if (stack.length >= 2)
                currentTopLevelLines?.push(line);
            stack.pop();
            if (stack.length === 1 && currentTopLevelLines) {
                if (currentTopLevelType === 'VEVENT')
                    eventBlocks.push(currentTopLevelLines);
                currentTopLevelLines = null;
                currentTopLevelType = '';
            }
            else if (stack.length === 0) {
                if (componentType !== 'VCALENDAR')
                    return null;
                rootClosed = true;
            }
            continue;
        }
        if (stack.length === 0) {
            if (line.trim())
                return null;
        }
        else if (stack.length >= 2 && line) {
            currentTopLevelLines?.push(line);
        }
    }
    if (!rootSeen || !rootClosed || stack.length !== 0 || currentTopLevelLines || eventBlocks.length !== 1) {
        return null;
    }
    const block = eventBlocks[0];
    const directUids = [];
    let directRecurrenceIds = 0;
    let nestedDepth = 0;
    for (const line of block.slice(1, -1)) {
        const separator = line.indexOf(':');
        const marker = separator > 0 ? line.slice(0, separator).toUpperCase() : '';
        if (marker === 'BEGIN') {
            nestedDepth += 1;
            continue;
        }
        if (marker === 'END') {
            nestedDepth = Math.max(0, nestedDepth - 1);
            continue;
        }
        if (nestedDepth !== 0 || separator < 1)
            continue;
        const propertyName = line.slice(0, separator).split(';', 1)[0].toUpperCase();
        if (propertyName === 'UID')
            directUids.push(line.slice(separator + 1));
        if (propertyName === 'RECURRENCE-ID')
            directRecurrenceIds += 1;
    }
    if (directUids.length !== 1 || directUids[0] !== expectedUid || directRecurrenceIds !== 0)
        return null;
    return block.join('\r\n');
}
const runCalendarSubscriptionFetchOnce = async (overrides = {}) => {
    const dependencies = { ...defaultWorkerDependencies, ...overrides };
    try {
        await (0, exports.ensureCalendarSubscriptionSchema)();
        const [calendars] = await db_1.pool.query(`SELECT id, user_id, subscribed_url, sync_token, last_fetched_at, last_fetch_error
             FROM calendars
             WHERE subscribed_url IS NOT NULL AND subscribed_url != ''
             AND (last_fetched_at IS NULL OR last_fetched_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
             AND (last_fetch_error IS NULL OR last_fetched_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))
             ORDER BY (last_fetched_at IS NOT NULL) ASC, last_fetched_at ASC, id ASC
             LIMIT ${exports.MAX_CALENDAR_SUBSCRIPTIONS_PER_RUN}`);
        const runDeadline = dependencies.now() + exports.MAX_CALENDAR_SUBSCRIPTION_RUN_MS;
        for (const cal of calendars) {
            const remainingRunMs = runDeadline - dependencies.now();
            if (remainingRunMs <= 0)
                break;
            const subscribedUrl = String(cal.subscribed_url || '');
            const selectedSyncToken = String(cal.sync_token ?? '');
            const lockName = subscriptionLockName(cal.id);
            let connection = null;
            let lockAcquired = false;
            let transactionStarted = false;
            let connectionUsable = true;
            let staleResponse = false;
            try {
                connection = await db_1.pool.getConnection();
                let lockRows;
                try {
                    [lockRows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
                }
                catch (error) {
                    connectionUsable = false;
                    throw error;
                }
                const acquired = Number(lockRows[0]?.acquired);
                if (acquired === 0)
                    continue;
                if (acquired !== 1) {
                    connectionUsable = false;
                    throw new Error('Calendar subscription lock state is ambiguous');
                }
                lockAcquired = true;
                const response = await dependencies.fetchSubscription(subscribedUrl, {
                    timeoutMs: Math.min(remainingRunMs, calendar_subscription_http_1.MAX_CALENDAR_SUBSCRIPTION_FETCH_MS),
                });
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                const validated = (0, calendar_ical_validation_1.validateICalendarDocument)(response, {
                    mode: 'subscription',
                    allowEmpty: true,
                    allowMultipleResourceUids: true,
                    maxResourceComponents: exports.MAX_CALENDAR_SUBSCRIPTION_EVENTS,
                });
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                const unsupportedResource = validated.resources
                    .find(resource => resource.componentType !== 'VEVENT');
                if (unsupportedResource) {
                    throw new Error(`Subscription feed contains unsupported ${unsupportedResource.componentType}; expected VEVENT resources`);
                }
                const feedEvents = new Map(validated.resources
                    .filter(resource => resource.componentType === 'VEVENT')
                    .map(resource => [resource.uid, resource.icalData]));
                await connection.beginTransaction();
                transactionStarted = true;
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                const [calendarRows] = await connection.query('SELECT subscribed_url, sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE', [cal.id]);
                if (calendarRows.length !== 1
                    || String(calendarRows[0].subscribed_url || '') !== subscribedUrl
                    || String(calendarRows[0].sync_token ?? '') !== selectedSyncToken) {
                    staleResponse = true;
                    await connection.rollback();
                    transactionStarted = false;
                    continue;
                }
                let revision = null;
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                const [storedRows] = await connection.query(`SELECT uid, resource_name, ical_data, subscription_managed FROM events
                     WHERE calendar_id = ? LIMIT ${exports.MAX_CALENDAR_SUBSCRIPTION_EVENTS + 1} FOR UPDATE`, [cal.id]);
                if (storedRows.length > exports.MAX_CALENDAR_SUBSCRIPTION_EVENTS) {
                    throw new Error('Calendar subscription contains too many stored resources');
                }
                const storedEvents = new Map(storedRows.map((row) => [String(row.uid), {
                        icalData: String(row.ical_data || ''),
                        managed: Number(row.subscription_managed) === 1,
                        resourceName: String(row.resource_name || row.uid),
                    }]));
                const legacyClaims = [];
                for (const row of storedRows) {
                    if (Number(row.subscription_managed) === 1)
                        continue;
                    const uid = String(row.uid);
                    const storedIcal = String(row.ical_data || '');
                    const canonicalIcal = feedEvents.get(uid);
                    if (!canonicalIcal) {
                        throw new Error('Subscribed calendar contains an unmatched unmanaged local event');
                    }
                    const storedFingerprint = normalizedLegacySingleEventBlock(storedIcal, uid);
                    const feedFingerprint = normalizedLegacySingleEventBlock(canonicalIcal, uid);
                    if (!storedFingerprint || !feedFingerprint) {
                        throw new Error('Legacy subscribed event ownership is structurally ambiguous');
                    }
                    if (storedFingerprint !== feedFingerprint) {
                        throw new Error('Subscription feed UID collides with a local calendar event that has different content');
                    }
                    legacyClaims.push({ uid, storedIcal });
                }
                for (const claim of legacyClaims) {
                    assertSubscriptionRunBudget(dependencies.now, runDeadline);
                    const [claimResult] = await connection.query(`UPDATE events
                         SET subscription_managed = 1
                         WHERE calendar_id = ? AND uid = ?
                         AND subscription_managed = 0 AND ical_data = ?`, [cal.id, claim.uid, claim.storedIcal]);
                    if (Number(claimResult.affectedRows || 0) !== 1) {
                        throw new Error('Legacy subscribed event ownership claim failed');
                    }
                    const stored = storedEvents.get(claim.uid);
                    storedEvents.set(claim.uid, {
                        ...stored,
                        managed: true,
                    });
                }
                for (const [uid, icalData] of feedEvents) {
                    assertSubscriptionRunBudget(dependencies.now, runDeadline);
                    const existing = storedEvents.get(uid);
                    const resourceName = existing?.resourceName || uid;
                    const [tombstoneResult] = await connection.query(`DELETE FROM calendar_tombstones
                         WHERE calendar_id = ?
                         AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [cal.id, resourceName]);
                    assertSubscriptionRunBudget(dependencies.now, runDeadline);
                    const changed = existing === undefined
                        || existing.icalData !== icalData
                        || Number(tombstoneResult.affectedRows || 0) > 0;
                    if (!changed)
                        continue;
                    revision ??= await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, cal.id);
                    if (existing !== undefined) {
                        await connection.query(`UPDATE events
                             SET ical_data = ?, sync_token = ?, subscription_managed = 1
                             WHERE calendar_id = ? AND uid = ? AND subscription_managed = 1`, [icalData, revision, cal.id, uid]);
                    }
                    else {
                        await connection.query(`INSERT INTO events
                             (calendar_id, uid, resource_name, ical_data, sync_token, subscription_managed)
                             VALUES (?, ?, ?, ?, ?, 1)`, [cal.id, uid, uid, icalData, revision]);
                    }
                }
                const removedEvents = storedRows
                    .filter((row) => Number(row.subscription_managed) === 1)
                    .map((row) => ({
                    uid: String(row.uid),
                    resourceName: String(row.resource_name || row.uid),
                }))
                    .filter((event) => !feedEvents.has(event.uid));
                for (const { uid, resourceName } of removedEvents) {
                    assertSubscriptionRunBudget(dependencies.now, runDeadline);
                    revision ??= await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, cal.id);
                    await connection.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [cal.id, uid]);
                    await connection.query(`INSERT INTO calendar_tombstones
                         (calendar_id, uid, resource_name, sync_token, deleted_at)
                         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                         ON DUPLICATE KEY UPDATE
                            uid = VALUES(uid), resource_name = VALUES(resource_name),
                            sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`, [cal.id, uid, resourceName, revision]);
                    assertSubscriptionRunBudget(dependencies.now, runDeadline);
                }
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                const [fetchStatusResult] = await connection.query(`UPDATE calendars
                     SET last_fetched_at = NOW(), last_fetch_error = NULL
                     WHERE id = ? AND subscribed_url = ?`, [cal.id, subscribedUrl]);
                if (Number(fetchStatusResult.affectedRows || 0) !== 1) {
                    staleResponse = true;
                    await connection.rollback();
                    transactionStarted = false;
                    continue;
                }
                assertSubscriptionRunBudget(dependencies.now, runDeadline);
                await connection.commit();
                transactionStarted = false;
                console.log(`[CalendarSub] Synced ${feedEvents.size} events to calendar ${cal.id}`);
            }
            catch (error) {
                if (transactionStarted) {
                    try {
                        await connection.rollback();
                        transactionStarted = false;
                    }
                    catch {
                        connectionUsable = false;
                    }
                }
                if (!staleResponse) {
                    const safeError = safeSubscriptionError(error, subscribedUrl);
                    if (lockAcquired && connectionUsable) {
                        try {
                            await connection.query(`UPDATE calendars
                                 SET last_fetched_at = NOW(), last_fetch_error = ?
                                 WHERE id = ? AND subscribed_url = ? AND sync_token = ?`, [safeError, cal.id, subscribedUrl, selectedSyncToken]);
                        }
                        catch {
                            connectionUsable = false;
                        }
                    }
                    console.error(`[CalendarSub] Calendar ${cal.id} sync failed: ${safeError}`);
                }
            }
            finally {
                if (connection) {
                    if (lockAcquired && connectionUsable) {
                        try {
                            const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
                            if (Number(releaseRows[0]?.released) !== 1)
                                connectionUsable = false;
                        }
                        catch {
                            connectionUsable = false;
                        }
                    }
                    if (connectionUsable)
                        connection.release();
                    else
                        connection.destroy?.();
                }
            }
        }
    }
    catch (error) {
        const safeError = safeSubscriptionError(error, '');
        console.error(`[CalendarSub] Subscription fetcher failed: ${safeError}`);
    }
};
exports.runCalendarSubscriptionFetchOnce = runCalendarSubscriptionFetchOnce;
const startCalendarSubscriptionWorker = () => {
    setInterval(exports.runCalendarSubscriptionFetchOnce, 15 * 60 * 1000);
    setTimeout(exports.runCalendarSubscriptionFetchOnce, 60 * 1000);
};
exports.startCalendarSubscriptionWorker = startCalendarSubscriptionWorker;
//# sourceMappingURL=calendar-subscription.js.map