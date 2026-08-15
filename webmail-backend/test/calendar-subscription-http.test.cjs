const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

function scriptedRequest(scripts, captures = []) {
  return (options, callback) => {
    captures.push(options);
    const request = new EventEmitter();
    request.end = () => {
      const script = scripts.shift();
      if (!script || script.never) return;
      queueMicrotask(() => {
        const response = Readable.from(script.chunks || [script.body || '']);
        response.statusCode = script.status || 200;
        response.headers = script.headers || {};
        callback(response);
      });
    };
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    return request;
  };
}

test('subscription URL policy requires credential-free HTTPS and a wholly public DNS answer', async () => {
  const {
    fetchCalendarSubscription,
    validateCalendarSubscriptionUrl,
  } = require('../src/calendar-subscription-http.js');

  for (const unsafe of [
    'http://calendar.example.test/feed.ics',
    'https://user:secret@calendar.example.test/feed.ics',
  ]) {
    assert.throws(() => validateCalendarSubscriptionUrl(unsafe), /HTTPS|credentials/i);
  }

  let requestCount = 0;
  const dependencies = {
    lookup: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
    request: () => { requestCount += 1; throw new Error('must not connect'); },
  };
  await assert.rejects(
    fetchCalendarSubscription('https://calendar.example.test/feed.ics', { dependencies }),
    /public address/i,
  );
  assert.equal(requestCount, 0);
});

test('every HTTPS hop connects through the address that was validated for that hostname', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  const captures = [];
  const lookups = [];
  const addresses = {
    'calendar.example.test': [{ address: '93.184.216.34', family: 4 }],
    'redirect.example.test': [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
  };
  const body = await fetchCalendarSubscription('https://calendar.example.test/feed.ics?token=secret', {
    dependencies: {
      lookup: async hostname => { lookups.push(hostname); return addresses[hostname]; },
      request: scriptedRequest([
        { status: 302, headers: { location: 'https://redirect.example.test/new.ics' } },
        { status: 200, body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' },
      ], captures),
    },
  });
  assert.equal(body.toString('utf8'), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  assert.deepEqual(lookups, ['calendar.example.test', 'redirect.example.test']);
  assert.equal(captures.length, 2);
  assert.ok(captures.every(options => options.agent === false));

  const pinned = await Promise.all(captures.map(options => new Promise((resolve, reject) => {
    options.lookup(options.hostname, { all: true }, (error, results) => {
      if (error) reject(error);
      else resolve(results);
    });
  })));
  assert.deepEqual(pinned, [addresses['calendar.example.test'], addresses['redirect.example.test']]);
});

test('redirects are resolved and rejected before a private rebinding target is contacted', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  let requestCount = 0;
  await assert.rejects(
    fetchCalendarSubscription('https://calendar.example.test/feed.ics', {
      dependencies: {
        lookup: async hostname => hostname === 'calendar.example.test'
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '::ffff:127.0.0.1', family: 6 }],
        request: (...args) => {
          requestCount += 1;
          return scriptedRequest([
            { status: 302, headers: { location: 'https://rebound.example.test/feed.ics' } },
          ])(...args);
        },
      },
    }),
    /public address/i,
  );
  assert.equal(requestCount, 1);
});

test('literal private IPv4 and IPv6 targets are rejected without DNS or HTTP', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  for (const url of [
    'https://127.0.0.1/feed.ics',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/feed.ics',
    'https://[fc00::1]/feed.ics',
    'https://[::ffff:127.0.0.1]/feed.ics',
  ]) {
    let boundaryCalls = 0;
    await assert.rejects(fetchCalendarSubscription(url, {
      dependencies: {
        lookup: async () => { boundaryCalls += 1; return []; },
        request: () => { boundaryCalls += 1; throw new Error('must not connect'); },
      },
    }), /public address/i);
    assert.equal(boundaryCalls, 0);
  }
});

test('content-length and chunked responses are bounded and request errors redact secret URLs', async () => {
  const {
    fetchCalendarSubscription,
    calendarSubscriptionLogLabel,
  } = require('../src/calendar-subscription-http.js');
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const secretUrl = 'https://calendar.example.test/private/secret-token.ics?access=secret-token';

  for (const request of [
    scriptedRequest([{ status: 200, headers: { 'content-length': '6' }, body: '123456' }]),
    scriptedRequest([{ status: 200, chunks: ['123', '456'] }]),
  ]) {
    const error = await fetchCalendarSubscription(secretUrl, {
      maxBodyBytes: 5,
      dependencies: { lookup, request },
    }).then(() => null, failure => failure);
    assert.match(error.message, /too large/i);
    assert.doesNotMatch(error.message, /secret-token|access=/i);
  }
  assert.equal(calendarSubscriptionLogLabel(secretUrl), 'calendar.example.test');
});

test('the total request deadline bounds a peer that never responds', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  const started = Date.now();
  await assert.rejects(fetchCalendarSubscription('https://calendar.example.test/feed.ics', {
    timeoutMs: 20,
    dependencies: {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: scriptedRequest([{ never: true }]),
    },
  }), /timed out/i);
  assert.ok(Date.now() - started < 1000);
});

test('the redirect budget is enforced without contacting an extra hop', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  let requestCount = 0;
  await assert.rejects(fetchCalendarSubscription('https://calendar.example.test/feed.ics', {
    maxRedirects: 0,
    dependencies: {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: (...args) => {
        requestCount += 1;
        return scriptedRequest([{
          status: 302,
          headers: { location: 'https://second.example.test/feed.ics' },
        }])(...args);
      },
    },
  }), /redirect limit/i);
  assert.equal(requestCount, 1);
});

test('invalid redirect budgets are rejected before DNS or HTTP work', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  for (const maxRedirects of [Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
    let boundaryCalls = 0;
    await assert.rejects(fetchCalendarSubscription('https://calendar.example.test/feed.ics', {
      maxRedirects,
      dependencies: {
        lookup: async () => { boundaryCalls += 1; return [{ address: '93.184.216.34', family: 4 }]; },
        request: () => { boundaryCalls += 1; throw new Error('must not connect'); },
      },
    }), /redirect limit.*invalid/i);
    assert.equal(boundaryCalls, 0);
  }
});

test('redirect and error responses are destroyed instead of draining unbounded bodies', async () => {
  const { fetchCalendarSubscription } = require('../src/calendar-subscription-http.js');
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

  for (const responseScript of [
    { status: 302, headers: { location: 'https://second.example.test/feed.ics' } },
    { status: 503, headers: {} },
  ]) {
    let response;
    const request = (_options, callback) => {
      const outgoing = new EventEmitter();
      outgoing.end = () => {
        response = new Readable({ read() {} });
        response.statusCode = responseScript.status;
        response.headers = responseScript.headers;
        callback(response);
      };
      outgoing.destroy = error => queueMicrotask(() => outgoing.emit('error', error));
      return outgoing;
    };
    await assert.rejects(fetchCalendarSubscription('https://calendar.example.test/feed.ics', {
      maxRedirects: 0,
      dependencies: { lookup, request },
    }), /redirect limit|HTTP 503/i);
    assert.equal(response.destroyed, true);
  }
});
