const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';
process.env.ENABLE_OMS_SCHEDULER = 'true';
process.env.OMS_SCHEDULER_PUBLIC_BASE_URL = 'https://scheduler.test';
process.env.OMS_SCHEDULER_HOST_ALIASES = 'scheduler.test';
process.env.OMS_SCHEDULER_SECRET_KEY = 'scheduler-slot-log-test-secret-key-material';

const request = (port, path, accessToken = '') => new Promise((resolve, reject) => {
    const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        headers: {
            Host: 'scheduler.test',
            ...(accessToken ? { 'X-Scheduler-Access': accessToken } : {}),
        },
    }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({
            status: response.statusCode,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
    });
    req.on('error', reject);
    req.end();
});

test('public slot route logs unexpected failures once and keeps validation failures quiet', async () => {
    const express = require('express');
    const { SchedulerStore } = require('../src/scheduler/store.js');
    const { schedulerRouter } = require('../src/scheduler/router.js');
    const originalListSlots = SchedulerStore.prototype.listSlots;
    const originalConsoleError = console.error;
    const logLines = [];
    let invalidRange = false;
    SchedulerStore.prototype.listSlots = async () => {
        if (invalidRange) throw new Error('Invalid availability range');
        throw Object.assign(new Error('Illegal mix of collations'), {
            code: 'ER_CANT_AGGREGATE_2COLLATIONS',
            sqlState: 'HY000',
            sql: 'SELECT private data',
        });
    };
    console.error = (...args) => logLines.push(args);

    const app = express();
    app.use('/api', schedulerRouter);
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    try {
        const port = server.address().port;
        const path = '/api/public/scheduler/v1/profiles/thang/events/discovery-call/slots'
            + '?start=2026-07-20T18%3A00%3A00.000Z&end=2026-09-20T18%3A00%3A00.000Z';
        const failure = await request(port, path, 'private-token-must-not-be-logged');
        assert.equal(failure.status, 500);
        assert.deepEqual(failure.json, { success: false, error: 'Unable to load availability' });
        assert.equal(logLines.length, 1);
        assert.equal(logLines[0].length, 1);
        const record = JSON.parse(logLines[0][0]);
        assert.equal(record.event, 'scheduler.slot_generation_failed');
        assert.equal(record.handle, 'thang');
        assert.equal(record.slug, 'discovery-call');
        assert.equal(record.privateAccess, true);
        assert.equal(record.errorCode, 'ER_CANT_AGGREGATE_2COLLATIONS');
        assert.equal(record.sqlState, 'HY000');
        assert.equal(logLines[0][0].includes('private-token-must-not-be-logged'), false);
        assert.equal(logLines[0][0].includes('SELECT private data'), false);

        invalidRange = true;
        const validation = await request(port, path);
        assert.equal(validation.status, 400);
        assert.deepEqual(validation.json, { success: false, error: 'Invalid availability range' });
        assert.equal(logLines.length, 1);
    } finally {
        SchedulerStore.prototype.listSlots = originalListSlots;
        console.error = originalConsoleError;
        await new Promise(resolve => server.close(resolve));
    }
});
