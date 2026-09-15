const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

test('selecting a group filters requests and phone updates refresh visible group counts', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior = { window: global.window, document: global.document, navigator: global.navigator, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT, fetch: global.fetch };
  Object.assign(global, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => ({ ok: true, json: async () => ({ user: { username: 'test@example.test' } }) }) });
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const events = new Map();
  const socket = { emit() {}, on: (name, callback) => events.set(name, callback), off: name => events.delete(name), disconnect() {} };
  let memberCount = 1;
  const requests = [];
  const sourcePath = path.resolve(__dirname, '../src/contacts/hooks/useContacts.ts');
  const loaded = new Module(sourcePath, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id === 'socket.io-client') return { io: () => socket };
    if (id === '../../settings/settingsApi') return { defaultContactsSettings: { sortBy: 'firstName' }, getUserSettings: async () => ({ sortBy: 'firstName' }) };
    if (id === '../../shared/api') return {
      fetchContacts: async (...args) => { requests.push(args); return { contacts: args[4] === 7 ? [{ id: 1, name: 'Member' }] : [{ id: 1, name: 'Member' }, { id: 2, name: 'Other' }], total: args[4] === 7 ? 1 : 2, hasMore: false }; },
      fetchContactGroups: async () => [{ id: 7, name: 'Friends', member_count: memberCount }],
      fetchContactLabels: async () => [], fetchContactDuplicates: async () => ({ groups: [] }), fetchTrashContacts: async () => ({ contacts: [] }),
    };
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sourcePath);
  function Harness() {
    const model = loaded.exports.useContacts();
    return React.createElement('div', null,
      React.createElement('button', { onClick: () => model.setSelectedGroupId(7) }, 'Friends'),
      React.createElement('button', { onClick: () => model.setSelectedGroupId(null) }, 'All'),
      React.createElement('p', null, model.contacts.map(contact => contact.name).join(',')),
      React.createElement('output', null, model.contactGroups[0]?.member_count));
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); Object.assign(global, prior); });
  const settle = async () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  await React.act(async () => root.render(React.createElement(Harness)));
  await settle();
  assert.equal(document.querySelector('p').textContent, 'Member,Other');
  await React.act(async () => document.querySelector('button').click());
  await settle();
  assert.equal(document.querySelector('p').textContent, 'Member');
  assert.equal(requests.at(-1)[4], 7);
  memberCount = 2;
  await React.act(async () => events.get('contacts_updated')());
  await settle();
  assert.equal(document.querySelector('output').textContent, '2');
  await React.act(async () => document.querySelectorAll('button')[1].click());
  await settle();
  assert.equal(document.querySelector('p').textContent, 'Member,Other');
});
