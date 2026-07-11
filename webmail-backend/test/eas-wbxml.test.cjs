const test = require('node:test');
const assert = require('node:assert/strict');

const { WbxmlWriter } = require('../src/wbxml/writer.js');

test('ActiveSync read flag change responses encode Read in the Email code page', () => {
  const writer = new WbxmlWriter();

  assert.doesNotThrow(() => writer.writeNode({
    tag: 'Sync',
    page: 0,
    children: [
      {
        tag: 'Collections',
        page: 0,
        children: [
          {
            tag: 'Collection',
            page: 0,
            children: [
              { tag: 'Class', page: 0, content: 'Email' },
              { tag: 'SyncKey', page: 0, content: '1-100-200' },
              { tag: 'CollectionId', page: 0, content: 'SU5CT1g=' },
              { tag: 'Status', page: 0, content: '1' },
              {
                tag: 'Responses',
                page: 0,
                children: [
                  {
                    tag: 'Change',
                    page: 0,
                    children: [
                      { tag: 'ServerId', page: 0, content: 'SU5CT1g=-42' },
                      {
                        tag: 'ApplicationData',
                        page: 0,
                        children: [
                          { tag: 'Read', page: 2, content: '1' }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));
});
