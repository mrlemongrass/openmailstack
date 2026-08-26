const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/settings/settingsApi.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;
const testModule = new Module(sourcePath, module);
testModule.paths = module.paths;
testModule._compile(compiled, sourcePath);

const {
  defaultCalendarSettings,
  getUserSettings,
  saveMailFavoriteSettings,
  saveUserSettings,
} = testModule.exports;

test('calendar defaults use the system zone and show the optional desktop clock', () => {
  assert.equal(defaultCalendarSettings.timeZoneMode, 'system');
  assert.equal(defaultCalendarSettings.showHeaderClock, true);
});

test('templates use the shared settings response and write contract', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const settings = options.method === 'PUT'
      ? JSON.parse(options.body).settings
      : { templates: [] };
    return {
      ok: true,
      json: async () => ({ success: true, namespace: 'templates', settings }),
    };
  };

  try {
    assert.deepEqual(await getUserSettings('templates'), { templates: [] });
    assert.deepEqual(
      await saveUserSettings('templates', {
        templates: [{ name: 'Follow up', content: 'Checking in.' }],
      }),
      { templates: [{ name: 'Follow up', content: 'Checking in.' }] },
    );

    assert.equal(calls[0].url, '/api/settings/templates');
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[1].url, '/api/settings/templates');
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      settings: { templates: [{ name: 'Follow up', content: 'Checking in.' }] },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Favorites use a scoped patch that cannot submit unrelated mail settings', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        success: true,
        namespace: 'mail',
        settings: {
          folders: {
            favorites: ['Projects'],
            favoriteUidValidities: { Projects: '101' },
          },
        },
      }),
    };
  };

  try {
    const folders = {
      favorites: ['Projects'],
      favoriteUidValidities: { Projects: '101' },
    };
    const saved = await saveMailFavoriteSettings(folders);

    assert.deepEqual(saved.folders, folders);
    assert.equal(calls[0].url, '/api/settings/mail/favorites');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.equal(calls[0].options.credentials, 'include');
    assert.deepEqual(JSON.parse(calls[0].options.body), { folders });
  } finally {
    global.fetch = originalFetch;
  }
});
