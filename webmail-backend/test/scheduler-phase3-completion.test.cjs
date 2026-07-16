const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
    SchedulerSecretBox,
    SchedulerWorkflowDeliveryDispatcher,
    bookingConsentAllows,
    normalizeCommunicationConsents,
    normalizeProviderConfig,
    normalizeWorkflowDefinition,
    renderWorkflowAction,
    workflowConditionMatches,
} = require('../src/scheduler/workflows.js');

const {
    createPinnedLookup,
    isBlockedProviderAddress,
    postSchedulerProviderJson,
    resolveProviderTarget,
} = require('../src/scheduler/provider-http.js');

test('Phase 3 definitions accept lifecycle triggers and every bounded delivery action', () => {
    const definition = normalizeWorkflowDefinition({
        trigger: { type: 'booking.no_show', offsetSeconds: 300 },
        steps: [
            { action: 'message.email', delaySeconds: 0, config: { recipient: 'guest', subject: 'We missed you, {{booker.name}}', body: '{{event.title}}', translations: { es: { subject: 'Te extrañamos, {{booker.name}}', body: '{{event.title}}' } } } },
            { action: 'notification.in_app', delaySeconds: 0, config: { title: 'No-show: {{event.title}}', body: '{{booker.name}} did not attend.' } },
            { action: 'webhook.http', delaySeconds: 10, config: { providerId: '11111111-1111-4111-8111-111111111111' } },
            { action: 'message.external', delaySeconds: 20, config: { providerId: '22222222-2222-4222-8222-222222222222', channel: 'sms', body: 'Follow up about {{event.title}}' } },
        ],
    });

    assert.equal(definition.trigger.type, 'booking.no_show');
    assert.deepEqual(definition.steps.map(step => step.action), [
        'message.email', 'notification.in_app', 'webhook.http', 'message.external',
    ]);
    assert.equal(definition.steps[0].config.translations.es.subject, 'Te extrañamos, {{booker.name}}');
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.cancelled', offsetSeconds: -1 },
        steps: [{ action: 'notification.in_app', delaySeconds: 0, config: { title: 'Cancelled', body: 'Cancelled' } }],
    }), /cannot run before a lifecycle event/);
});

test('workflow rendering selects the booking locale and expands only documented variables', () => {
    const rendered = renderWorkflowAction({
        bookingId: 'booking-1', hostEmail: 'owner@housevo.us', bookerEmail: 'ada@example.net',
        bookerName: 'Ada', bookerPhone: '+16025550123', title: 'Design review',
        start: '2054-08-03T16:00:00.000Z', timeZone: 'America/Phoenix', locale: 'es',
        manageUrl: 'https://mail.housevo.us/scheduler/action/reschedule/token',
    }, {
        recipient: 'guest', subject: 'Reminder: {{event.title}}', body: 'Hello {{booker.name}}',
        translations: { es: { subject: 'Recordatorio: {{event.title}}', body: 'Hola {{booker.name}} · {{booking.manage_url}}' } },
    });

    assert.equal(rendered.subject, 'Recordatorio: Design review');
    assert.equal(rendered.body, 'Hola Ada · https://mail.housevo.us/scheduler/action/reschedule/token');
    assert.equal(rendered.recipient, 'ada@example.net');
    assert.equal(rendered.phone, '+16025550123');
    assert.throws(() => renderWorkflowAction({
        bookingId: 'booking-1', hostEmail: 'owner@housevo.us', bookerEmail: 'ada@example.net',
        bookerName: 'Ada', title: 'Design review', start: '2054-08-03T16:00:00.000Z',
        timeZone: 'UTC', manageUrl: 'https://mail.housevo.us/scheduler',
    }, { recipient: 'guest', subject: '{{unknown.value}}', body: 'Body' }), /Unsupported workflow variable/);
});

test('communication consent is explicit, channel bounded, and phone normalized', () => {
    assert.deepEqual(normalizeCommunicationConsents({
        phone: ' +1 (602) 555-0123 ', channels: ['sms', 'whatsapp', 'sms'],
    }), { phone: '+16025550123', channels: ['sms', 'whatsapp'] });
    assert.throws(() => normalizeCommunicationConsents({ phone: '602-555-0123', channels: ['sms'] }), /international format/);
    assert.throws(() => normalizeCommunicationConsents({ phone: '+16025550123', channels: ['voice', 'email'] }), /Unsupported communication channel/);
    assert.deepEqual(normalizeCommunicationConsents({ phone: '+16025550123', channels: [] }), { phone: '', channels: [] });
    assert.equal(bookingConsentAllows({ communicationConsents: ['sms'] }, 'sms'), true);
    assert.equal(bookingConsentAllows({ communicationConsents: ['whatsapp'] }, 'sms'), false);
    assert.equal(bookingConsentAllows({}, 'sms'), false);
});

test('workflow conditions are bounded and evaluated from the immutable booking payload', () => {
    const definition = normalizeWorkflowDefinition({
        trigger: { type: 'booking.requested', offsetSeconds: 0 },
        steps: [{
            action: 'message.email', delaySeconds: 0,
            condition: { field: 'booking.status', operator: 'equals', value: 'requested' },
            config: { subject: 'Request received', body: '{{event.title}}' },
        }],
    });
    assert.equal(workflowConditionMatches(definition.steps[0].condition, {
        status: 'requested', locale: 'en', communicationConsents: [],
    }), true);
    assert.equal(workflowConditionMatches(definition.steps[0].condition, {
        status: 'confirmed', locale: 'en', communicationConsents: [],
    }), false);
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.ended', offsetSeconds: 0 },
        steps: [{
            action: 'message.email', delaySeconds: 0,
            condition: { field: 'booking.secret', operator: 'equals', value: 'x' },
            config: { subject: 'x', body: 'x' },
        }],
    }), /condition field/);
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.ended', offsetSeconds: 0 },
        steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: '{{unknown.value}}', body: 'Body' } }],
    }), /Unsupported workflow variable/);
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.ended', offsetSeconds: 0 },
        steps: [{
            action: 'message.email', delaySeconds: 0,
            config: {
                subject: 'Hello {{booker.name}}', body: 'Body',
                translations: { es: { subject: 'Hola', body: 'Body' } },
            },
        }],
    }), /must preserve the original workflow variables/);
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.ended', offsetSeconds: 0 },
        steps: [{
            action: 'message.email', delaySeconds: 0,
            config: {
                subject: '{{booker.name}} meets {{booker.name}}', body: 'Body',
                translations: { es: { subject: '{{booker.name}} se reune', body: 'Body' } },
            },
        }],
    }), /must preserve the original workflow variables/);
});

test('provider addresses reject mapped/private ranges and pin the validated DNS result', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) {
        assert.equal(isBlockedProviderAddress(address), true, `${address} must be blocked`);
    }
    assert.equal(isBlockedProviderAddress('93.184.216.34'), false);
    let resolutions = 0;
    const target = await resolveProviderTarget(new URL('https://provider.example.test/hook'), false, async () => {
        resolutions += 1;
        return [{ address: '93.184.216.34', family: 4 }];
    });
    const pinnedLookup = createPinnedLookup(target);
    const resolved = await new Promise((resolve, reject) => pinnedLookup('provider.example.test', {}, (error, address, family) => {
        if (error) reject(error); else resolve({ address, family });
    }));
    assert.deepEqual(resolved, { address: '93.184.216.34', family: 4 });
    const resolvedAll = await new Promise((resolve, reject) => pinnedLookup(
        'provider.example.test', { all: true }, (error, addresses) => {
            if (error) reject(error); else resolve(addresses);
        },
    ));
    assert.deepEqual(resolvedAll, [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(resolutions, 1, 'the request must not perform a second DNS lookup');
});

test('provider HTTP performs a real pinned HTTPS hostname request without socket pooling', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-provider-https-'));
    const keyPath = path.join(directory, 'key.pem');
    const certPath = path.join(directory, 'cert.pem');
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
        '-keyout', keyPath, '-out', certPath,
    ], { stdio: 'ignore' });
    let received = '';
    const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (request, response) => {
        request.setEncoding('utf8');
        request.on('data', chunk => { received += chunk; });
        request.on('end', () => {
            response.writeHead(202, { 'content-type': 'application/json' });
            response.end('{"accepted":true}');
        });
    });
    const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, resolve);
        });
        const address = server.address();
        const response = await postSchedulerProviderJson(
            new URL(`https://localhost:${address.port}/scheduler`),
            { 'content-type': 'application/json' }, '{"probe":true}', 5, true,
        );
        assert.equal(response.status, 202);
        assert.equal(received, '{"probe":true}');
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (previousTlsSetting == null) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('external dispatch requires this booking consent and treats provider 5xx as uncertain', async () => {
    const providers = {
        forDelivery: async () => ({
            id: 'provider-1', tenantKey: 'housevo.us', name: 'SMS', channel: 'sms',
            endpointUrl: 'https://provider.example.test/send', authHeaderName: 'Authorization',
            timeoutSeconds: 10, allowPrivateNetwork: false, enabled: true, hasSecret: false,
        }),
    };
    const preferences = {
        current: async () => ({ phone: '+16025550123', token: 'unsubscribe-token-value-that-is-long-enough' }),
    };
    const payload = {
        tenantKey: 'housevo.us', bookingId: 'booking-1', hostEmail: 'owner@housevo.us',
        bookerEmail: 'ada@example.net', bookerName: 'Ada', bookerPhone: '+16025550123',
        title: 'Design review', start: '2054-08-03T16:00:00.000Z', timeZone: 'UTC',
        manageUrl: 'https://mail.housevo.us/scheduler', communicationConsents: [],
    };
    const job = {
        id: 'job-1', tenantKey: 'housevo.us', bookingId: 'booking-1', attempts: 1,
        idempotencyKey: 'workflow:booking-1:sms', jobType: 'message.external', payload,
        config: { providerId: 'provider-1', channel: 'sms', body: 'Hello {{booker.name}}' },
    };
    const dispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, providers, preferences,
        'https://mail.housevo.us', async () => ({ status: 503, headers: {}, body: '' }),
    );
    await assert.rejects(() => dispatcher.deliver(job), error => (
        error.code === 'booking_consent_missing' && error.disposition === 'policy_skip'
    ));
    job.payload.communicationConsents = ['sms'];
    await assert.rejects(() => dispatcher.deliver(job), error => (
        error.code === 'provider_http_503' && error.disposition === 'delivery_uncertain'
    ));

    let voiceRequest;
    const voiceDispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, {
            forDelivery: async () => ({
                id: 'provider-voice', tenantKey: 'housevo.us', name: 'Voice', channel: 'voice',
                endpointUrl: 'https://provider.example.test/call', authHeaderName: 'Authorization',
                timeoutSeconds: 10, allowPrivateNetwork: false, enabled: true, hasSecret: false,
            }),
        }, { current: async () => ({ phone: '+16025550999', token: 'unsubscribe-token-value-that-is-long-enough' }) },
        'https://mail.housevo.us', async (_endpoint, _headers, raw) => {
            voiceRequest = JSON.parse(raw);
            return { status: 202, headers: {}, body: '' };
        },
    );
    job.config = { providerId: 'provider-voice', channel: 'voice', body: 'Hello {{booker.name}}' };
    job.payload.communicationConsents = ['voice'];
    await voiceDispatcher.deliver(job);
    assert.equal(voiceRequest.to, '+16025550123', 'delivery must use the phone captured on this booking');
    assert.match(voiceRequest.unsubscribeUrl, /\/api\/public\/scheduler\/v1\/unsubscribe\//);
});

test('webhook provider tests carry the same body signature as live deliveries', async () => {
    let captured;
    const health = [];
    const secret = 'webhook-signing-secret';
    const dispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, {
            forDelivery: async () => ({
                id: 'webhook-1', tenantKey: 'housevo.us', name: 'Webhook', channel: 'webhook',
                endpointUrl: 'https://provider.example.test/hook', authHeaderName: 'Authorization',
                timeoutSeconds: 10, allowPrivateNetwork: false, enabled: true, hasSecret: true, secret,
            }),
            recordTest: async (...args) => health.push(args),
        }, {}, 'https://mail.housevo.us', async (_endpoint, headers, raw) => {
            captured = { headers, raw };
            return { status: 204, headers: {}, body: '' };
        },
    );
    await dispatcher.testProvider('housevo.us', 'webhook-1');
    const crypto = require('node:crypto');
    assert.equal(captured.headers['x-oms-scheduler-signature'],
        `sha256=${crypto.createHmac('sha256', secret).update(captured.raw).digest('hex')}`);
    assert.deepEqual(health, [['webhook-1', 'healthy']]);
});

test('translation adapters return immutable rendered variants while retaining originals', async () => {
    const providers = {
        forDelivery: async () => ({
            id: 'translation-1', tenantKey: 'housevo.us', name: 'Translator', channel: 'translation',
            endpointUrl: 'https://provider.example.test/translate', authHeaderName: 'Authorization',
            timeoutSeconds: 10, allowPrivateNetwork: false, enabled: true, hasSecret: false,
        }),
    };
    const dispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, providers, {},
        'https://mail.housevo.us', async () => ({
            status: 200, headers: {}, body: JSON.stringify({
                steps: [{ index: 0, translations: { es: { subject: 'Recordatorio: {{event.title}}', body: 'Hola {{booker.name}}' } } }],
            }),
        }),
    );
    const translated = await dispatcher.translateDefinition('housevo.us', 'translation-1', ['es'], {
        trigger: { type: 'booking.start', offsetSeconds: -3600 },
        steps: [{
            action: 'message.email', delaySeconds: 0,
            config: { subject: 'Reminder: {{event.title}}', body: 'Hello {{booker.name}}' },
        }],
    });
    assert.equal(translated.steps[0].config.subject, 'Reminder: {{event.title}}');
    assert.equal(translated.steps[0].config.body, 'Hello {{booker.name}}');
    assert.equal(translated.steps[0].config.translations.es.subject, 'Recordatorio: {{event.title}}');

    const incompleteDispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, providers, {},
        'https://mail.housevo.us', async () => ({
            status: 200, headers: {}, body: JSON.stringify({
                steps: [{ index: 0, translations: { es: { subject: 'Recordatorio' } } }],
            }),
        }),
    );
    await assert.rejects(() => incompleteDispatcher.translateDefinition(
        'housevo.us', 'translation-1', ['es'], {
            trigger: { type: 'booking.start', offsetSeconds: -3600 },
            steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: 'Reminder', body: 'Hello' } }],
        },
    ), /omitted es text/);

    const unsafeDispatcher = new SchedulerWorkflowDeliveryDispatcher(
        {}, { name: 'smtp', send: async () => ({}) }, providers, {},
        'https://mail.housevo.us', async () => ({
            status: 200, headers: {}, body: JSON.stringify({
                steps: [{ index: 0, translations: { es: { subject: 'Recordatorio: {{event.title}}', body: 'Hola' } } }],
            }),
        }),
    );
    await assert.rejects(() => unsafeDispatcher.translateDefinition(
        'housevo.us', 'translation-1', ['es'], {
            trigger: { type: 'booking.start', offsetSeconds: -3600 },
            steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: 'Reminder: {{event.title}}', body: 'Hello {{booker.name}}' } }],
        },
    ), /must preserve the original workflow variables/);
});

test('provider configuration never returns a secret and encrypted secrets round trip', () => {
    const provider = normalizeProviderConfig({
        name: 'Primary messaging adapter', channel: 'sms', endpointUrl: 'https://provider.example.test/scheduler',
        authHeaderName: 'Authorization', secret: 'Bearer private-value', timeoutSeconds: 12,
    });
    assert.equal(provider.endpointUrl, 'https://provider.example.test/scheduler');
    assert.equal(provider.secret, 'Bearer private-value');
    assert.throws(() => normalizeProviderConfig({
        name: 'Unsafe', channel: 'webhook', endpointUrl: 'http://127.0.0.1/hook', secret: 'x',
    }), /HTTPS/);

    const box = new SchedulerSecretBox({ currentVersion: 2, keys: { 1: 'old-test-only-key', 2: 'new-test-only-key' } });
    const encrypted = box.encrypt('Bearer private-value', 'provider');
    assert.notEqual(encrypted.ciphertext, 'Bearer private-value');
    assert.equal(encrypted.keyVersion, 2);
    assert.equal(box.decrypt(encrypted, 'provider'), 'Bearer private-value');

    const oldBox = new SchedulerSecretBox('old-test-only-key');
    const oldEncrypted = oldBox.encrypt('legacy value', 'provider');
    assert.equal(box.decrypt(oldEncrypted, 'provider'), 'legacy value');
});
