const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';
process.env.ENABLE_OMS_SCHEDULER = 'true';
process.env.OMS_SCHEDULER_PUBLIC_BASE_URL = 'https://scheduler.test';
process.env.OMS_SCHEDULER_HOST_ALIASES = 'scheduler.test';
process.env.OMS_SCHEDULER_SECRET_KEY = 'scheduler-route-test-secret-key-material';
process.env.OMS_SCHEDULER_SECRET_KEY_VERSION = '1';

const request = (port, path, { method = 'GET', cookie, body, host = 'scheduler.test' } = {}) => new Promise((resolve, reject) => {
    const raw = body == null ? '' : JSON.stringify(body);
    const req = http.request({
        hostname: '127.0.0.1', port, path, method,
        headers: {
            Host: host,
            ...(cookie ? { Cookie: cookie } : {}),
            ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}),
        },
    }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch {}
            resolve({ status: response.statusCode, text, json, headers: response.headers });
        });
    });
    req.on('error', reject);
    req.end(raw);
});

test('Phase 3 Express routes enforce sessions, tenant scope, admin scope, notification IDOR, and unsubscribe confirmation', {
    skip: process.env.OMS_SCHEDULER_PHASE1_DB_TEST !== '1',
}, async () => {
    const express = require('express');
    const { pool } = require('../src/db.js');
    const { createSession } = require('../src/auth.js');
    const { SchedulerStore } = require('../src/scheduler/store.js');
    const {
        SchedulerContactPreferenceRepository,
        SchedulerSecretBox,
        SchedulerWorkflowRepository,
    } = require('../src/scheduler/workflows.js');
    const { schedulerRouter } = require('../src/scheduler/router.js');

    await pool.query(`CREATE TABLE IF NOT EXISTS mailbox (
        username VARCHAR(255) PRIMARY KEY, name VARCHAR(255), local_part VARCHAR(255), domain VARCHAR(255), active TINYINT(1)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin (
        username VARCHAR(255) PRIMARY KEY, active TINYINT(1) NOT NULL DEFAULT 1,
        superadmin TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);

    const ownerA = 'route-owner-a@route.test';
    const ownerB = 'route-owner-b@other.test';
    const admin = 'route-admin@route.test';
    await pool.query(
        `INSERT INTO mailbox (username,name,local_part,domain,active) VALUES
         (?, 'Owner A', 'route-owner-a', 'route.test', 1),
         (?, 'Owner B', 'route-owner-b', 'other.test', 1)
         ON DUPLICATE KEY UPDATE active=1`,
        [ownerA, ownerB],
    );
    await pool.query(
        `INSERT INTO admin (username,active,superadmin) VALUES (?,1,1)
         ON DUPLICATE KEY UPDATE active=1,superadmin=1`,
        [admin],
    );
    const store = new SchedulerStore(pool);
    await store.setEntitlement(ownerA, admin, { enabled: true, handle: 'route-owner-a', timeZone: 'UTC' });
    await store.setEntitlement(ownerB, admin, { enabled: true, handle: 'route-owner-b', timeZone: 'UTC' });

    const cookieFor = async (username, isAdmin = false) => {
        let cookie = '';
        await createSession({ setHeader: (_name, value) => { cookie = String(value).split(';')[0]; } }, {
            username, password: 'route-test-password', isAdmin,
        });
        return cookie;
    };
    const [ownerACookie, ownerBCookie, adminCookie] = await Promise.all([
        cookieFor(ownerA), cookieFor(ownerB), cookieFor(admin, true),
    ]);

    const workflows = new SchedulerWorkflowRepository(pool);
    const workflow = await workflows.createWorkflow({
        tenantKey: 'route.test', ownerUsername: ownerA, name: 'Route authorization', enabled: false, eventTypeIds: [],
    });
    const version = await workflows.publishVersion(workflow.id, ownerA, {
        trigger: { type: 'booking.confirmed', offsetSeconds: 0 },
        steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: 'Route test', body: 'Body' } }],
    });
    const [[step]] = await pool.query(
        'SELECT id FROM scheduler_workflow_steps WHERE workflow_version_id=? ORDER BY step_order LIMIT 1',
        [version.id],
    );
    const skippedJobId = '73333333-3333-4333-8333-333333333333';
    const deliveredJobId = '74444444-4444-4444-8444-444444444444';
    await pool.query(
        `INSERT INTO scheduler_jobs
            (id,tenant_key,workflow_version_id,workflow_step_id,job_type,idempotency_key,payload,
             available_at,attempts,completed_at,last_error_code) VALUES
         (?, 'route.test', ?, ?, 'message.email', 'route-metric-skipped', '{}', UTC_TIMESTAMP(3), 0,
          UTC_TIMESTAMP(3), 'condition_not_met'),
         (?, 'route.test', ?, ?, 'message.email', 'route-metric-sent', '{}', UTC_TIMESTAMP(3), 1,
          UTC_TIMESTAMP(3), NULL)`,
        [skippedJobId, version.id, step.id, deliveredJobId, version.id, step.id],
    );
    await pool.query(
        `INSERT INTO scheduler_delivery_attempts
            (id,tenant_key,job_id,attempt_no,provider,outcome)
         VALUES ('75555555-5555-4555-8555-555555555555','route.test',?,1,'smtp','sent')`,
        [deliveredJobId],
    );
    const ownNotificationId = '71111111-1111-4111-8111-111111111111';
    const otherNotificationId = '72222222-2222-4222-8222-222222222222';
    await pool.query(
        `INSERT INTO scheduler_in_app_notifications
            (id,tenant_key,recipient_username,idempotency_key,title,body) VALUES
         (?, 'route.test', ?, 'route-notification-a', 'Owner A notice', 'Visible to owner A'),
         (?, 'other.test', ?, 'route-notification-b', 'Owner B notice', 'Visible to owner B')`,
        [ownNotificationId, ownerA, otherNotificationId, ownerB],
    );

    const app = express();
    app.use(express.json());
    app.use('/api', schedulerRouter);
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    try {
        assert.equal((await request(port, '/api/scheduler/v1/workflows')).status, 401);
        const ownWorkflows = await request(port, '/api/scheduler/v1/workflows', { cookie: ownerACookie });
        assert.equal(ownWorkflows.status, 200);
        assert.equal(ownWorkflows.json.workflows.some(item => item.id === workflow.id), true);
        assert.equal((await request(port, `/api/scheduler/v1/workflows/${workflow.id}`, {
            method: 'PUT', cookie: ownerBCookie, body: { name: 'Cross-tenant change' },
        })).status, 404);

        assert.equal((await request(port, '/api/admin/scheduler/v1/providers', { cookie: ownerACookie })).status, 403);
        const providerResponse = await request(port, '/api/admin/scheduler/v1/providers', {
            method: 'POST', cookie: adminCookie, body: {
                tenantKey: 'route.test', name: 'Route webhook', channel: 'webhook',
                endpointUrl: 'https://adapter.example.test/route', authHeaderName: 'Authorization',
                secret: 'route-webhook-signing-secret', timeoutSeconds: 10, enabled: true,
            },
        });
        assert.equal(providerResponse.status, 201);
        const ownerProviders = await request(port, '/api/scheduler/v1/delivery-providers', { cookie: ownerACookie });
        const otherProviders = await request(port, '/api/scheduler/v1/delivery-providers', { cookie: ownerBCookie });
        assert.equal(ownerProviders.json.providers.some(item => item.id === providerResponse.json.provider.id), true);
        assert.equal(otherProviders.json.providers.length, 0);
        const adminOperations = await request(
            port, '/api/admin/scheduler/v1/workflow-operations?tenantKey=route.test', { cookie: adminCookie },
        );
        assert.equal(adminOperations.status, 200);
        assert.deepEqual(adminOperations.json.metrics, {
            activeWorkflows: 0,
            totalJobs: 2,
            queuedJobs: 0,
            recoveryJobs: 0,
            delivered24h: 1,
            openAlerts: 0,
        });

        assert.equal((await request(port, `/api/scheduler/v1/notifications/${otherNotificationId}/read`, {
            method: 'POST', cookie: ownerACookie, body: {},
        })).status, 404);
        assert.equal((await request(port, `/api/scheduler/v1/notifications/${ownNotificationId}/read`, {
            method: 'POST', cookie: ownerACookie, body: {},
        })).status, 200);
        assert.equal((await request(port, `/api/scheduler/v1/notifications/${otherNotificationId}`, {
            method: 'DELETE', cookie: ownerACookie,
        })).status, 404);
        assert.equal((await request(port, `/api/scheduler/v1/notifications/${ownNotificationId}`, {
            method: 'DELETE', cookie: ownerACookie,
        })).status, 200);
        const ownNotifications = await request(port, '/api/scheduler/v1/notifications', {
            cookie: ownerACookie,
        });
        assert.equal(
            ownNotifications.json.notifications.some(item => item.id === ownNotificationId),
            false,
        );
        const [[retainedDeliveryJob]] = await pool.query(
            'SELECT id FROM scheduler_jobs WHERE id=?',
            [deliveredJobId],
        );
        assert.equal(retainedDeliveryJob.id, deliveredJobId);

        const preferences = new SchedulerContactPreferenceRepository(
            pool, new SchedulerSecretBox('scheduler-route-test-secret-key-material'),
        );
        await preferences.recordConsents(pool, 'route.test', 'route-guest@example.net', {
            phone: '+16025550155', channels: ['sms'],
        });
        const preference = await preferences.current('route.test', 'route-guest@example.net', 'sms');
        const unsubscribePath = `/api/public/scheduler/v1/unsubscribe/${encodeURIComponent(preference.token)}`;
        const confirmation = await request(port, unsubscribePath);
        assert.equal(confirmation.status, 200);
        assert.match(confirmation.text, /Confirm unsubscribe/);
        assert.ok(await preferences.current('route.test', 'route-guest@example.net', 'sms'), 'GET must not mutate consent');
        assert.equal((await request(port, unsubscribePath, { method: 'POST' })).status, 200);
        assert.equal(await preferences.current('route.test', 'route-guest@example.net', 'sms'), null);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await pool.end();
    }
});
