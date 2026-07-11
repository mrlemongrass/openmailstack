const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activeSyncContactApplicationDataToVCard,
  contactToActiveSyncApplicationData,
} = require('../src/eas-contacts.js');

test('preserves multiple phone fields from an iOS ActiveSync contact change', () => {
  const vcard = activeSyncContactApplicationDataToVCard('eas-13623', {
    tag: 'ApplicationData',
    page: 0,
    children: [
      { tag: 'BusinessPhoneNumber', page: 1, content: '(602) 555-1212' },
      { tag: 'CompanyName', page: 1, content: 'OpenMailStack Test' },
      { tag: 'Email1Address', page: 1, content: 'oms-contact-test@housevo.us' },
      { tag: 'FileAs', page: 1, content: 'OMS iPhone Contact Test' },
      { tag: 'FirstName', page: 1, content: 'OMS iPhone Contact Test' },
      { tag: 'HomePhoneNumber', page: 1, content: '(602) 987-6543' },
    ],
  });

  assert.match(vcard, /TEL;TYPE=WORK:\(602\) 555-1212/);
  assert.match(vcard, /TEL;TYPE=HOME:\(602\) 987-6543/);
  assert.match(vcard, /ORG:OpenMailStack Test/);
});

test('exports stored multi-phone contacts to distinct ActiveSync phone fields', () => {
  const applicationData = contactToActiveSyncApplicationData({
    name: 'OMS iPhone Contact Test',
    email: 'oms-contact-test@housevo.us',
    phone: '(602) 555-1212',
    phones_json: JSON.stringify([
      { value: '(602) 555-1212', label: 'Work' },
      { value: '(602) 987-6543', label: 'Home' },
    ]),
    organization: 'OpenMailStack Test',
  }, 'BEGIN:VCARD\r\nEND:VCARD\r\n');

  const byTag = new Map(applicationData.map(node => [node.tag, node.content]));
  assert.equal(byTag.get('BusinessPhoneNumber'), '(602) 555-1212');
  assert.equal(byTag.get('HomePhoneNumber'), '(602) 987-6543');
  assert.equal(byTag.get('CompanyName'), 'OpenMailStack Test');
});
