const assert = require('node:assert/strict');
const test = require('node:test');

const { activeSyncSettingsResponseNode } = require('../src/eas-settings.js');

const oofGet = bodyType => ({
  tag: 'Settings',
  page: 18,
  children: [{
    tag: 'Oof',
    page: 18,
    children: [{
      tag: 'Get',
      page: 18,
      children: [{ tag: 'BodyType', page: 18, content: bodyType, children: [] }],
    }],
  }],
});

const success = {
  tag: 'Settings',
  page: 18,
  children: [
    { tag: 'Status', page: 18, content: '1' },
    {
      tag: 'Oof',
      page: 18,
      children: [
        { tag: 'Status', page: 18, content: '1' },
        {
          tag: 'Get',
          page: 18,
          children: [{ tag: 'OofState', page: 18, content: '0' }],
        },
      ],
    },
  ],
};

test('OOF Settings Get reports the unsupported feature as disabled', () => {
  assert.deepEqual(activeSyncSettingsResponseNode(oofGet('Text')), success);
  assert.deepEqual(activeSyncSettingsResponseNode(oofGet('HTML')), success);
});

test('Settings rejects malformed or unsupported property operations as protocol errors', () => {
  const protocolError = {
    tag: 'Settings',
    page: 18,
    children: [{ tag: 'Status', page: 18, content: '2' }],
  };
  for (const request of [
    null,
    { ...oofGet('HTML'), page: 0 },
    { ...oofGet('HTML'), tag: 'Ping' },
    { ...oofGet('HTML'), content: 'private' },
    { ...oofGet('HTML'), children: [] },
    { ...oofGet('HTML'), children: [...oofGet('HTML').children, ...oofGet('HTML').children] },
    { ...oofGet('HTML'), children: [{ ...oofGet('HTML').children[0], page: 0 }] },
    { ...oofGet('HTML'), children: [{ ...oofGet('HTML').children[0], content: 'private' }] },
    {
      ...oofGet('HTML'),
      children: [{ ...oofGet('HTML').children[0], children: [{ tag: 'Set', page: 18, children: [] }] }],
    },
    {
      ...oofGet('HTML'),
      children: [{
        ...oofGet('HTML').children[0],
        children: [{ ...oofGet('HTML').children[0].children[0], children: [] }],
      }],
    },
    oofGet('RTF'),
    oofGet(Buffer.from('HTML')),
  ]) {
    assert.deepEqual(activeSyncSettingsResponseNode(request), protocolError);
  }
});
