const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const defaultCalendarSettings = {
  defaultCalendarId: null,
  defaultView: 'month',
  defaultEventDurationMinutes: 60,
  defaultReminderMinutes: 10,
  weekStartsOn: 0,
  timeZoneMode: 'system',
  timeZone: 'UTC',
  clockFormat: '12h',
  showHeaderClock: true,
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  visibleDays: [0, 1, 2, 3, 4, 5, 6],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadHook(getUserSettings) {
  const sourcePath = path.resolve(__dirname, '../src/shared/hooks/useCalendarSettings.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const testModule = new Module(sourcePath, module);
  testModule.paths = module.paths;
  testModule.require = id => id === '../../settings/settingsApi'
    ? {
        CALENDAR_SETTINGS_CHANGED: 'oms:calendar-settings-changed',
        defaultCalendarSettings,
        getUserSettings,
      }
    : Module.prototype.require.call(testModule, id);
  testModule._compile(compiled, sourcePath);
  return testModule.exports;
}

test('calendar settings loader exposes failure/retry and ignores stale or disposed requests', async () => {
  const requests = [];
  const { createCalendarSettingsLoader } = loadHook(async () => defaultCalendarSettings);
  let current = { settings: defaultCalendarSettings, isLoading: false, error: '' };
  const loader = createCalendarSettingsLoader(
    () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    next => { current = { ...current, ...next }; }
  );

  const initialPromise = loader.refresh();
  requests[0].reject(new Error('Calendar settings unavailable'));
  await initialPromise;
  assert.equal(current.isLoading, false);
  assert.equal(current.error, 'Calendar settings unavailable');

  const retryPromise = loader.refresh();
  const baghdad = { ...defaultCalendarSettings, timeZoneMode: 'home', timeZone: 'Asia/Baghdad' };
  requests[1].resolve(baghdad);
  await retryPromise;
  assert.equal(current.error, '');
  assert.equal(current.settings.timeZone, 'Asia/Baghdad');

  const olderPromise = loader.refresh();
  const newerPromise = loader.refresh();
  const phoenix = { ...defaultCalendarSettings, timeZoneMode: 'home', timeZone: 'America/Phoenix' };
  requests[3].resolve(phoenix);
  await newerPromise;
  requests[2].resolve(baghdad);
  await olderPromise;
  assert.equal(current.settings.timeZone, 'America/Phoenix');

  const disposedPromise = loader.refresh();
  loader.dispose();
  requests[4].resolve(baghdad);
  await disposedPromise;
  assert.equal(current.settings.timeZone, 'America/Phoenix');
});
