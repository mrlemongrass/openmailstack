const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ActiveSyncContactPictureError,
  ActiveSyncContactFieldError,
  MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES,
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

  assert.match(vcard, /TEL;TYPE=WORK;X-OMS-EAS-SLOT=BusinessPhoneNumber:\(602\) 555-1212/);
  assert.match(vcard, /TEL;TYPE=HOME;X-OMS-EAS-SLOT=HomePhoneNumber:\(602\) 987-6543/);
  assert.match(vcard, /ORG:OpenMailStack Test/);
});

test('partial contact Change preserves omitted fields and accepts plain-base64 Picture', () => {
  const originalPicture = Buffer.from('original-picture').toString('base64');
  const existing = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:contact-a',
    'FN:Before Name',
    'N:Name;Before;;;',
    'EMAIL;TYPE=INTERNET:before@example.test',
    'TEL;TYPE=CELL:+15551234567',
    'NOTE:Private note',
    `PHOTO;ENCODING=BASE64;TYPE=JPEG:${originalPicture}`,
    'END:VCARD',
    '',
  ].join('\r\n');
  const changed = activeSyncContactApplicationDataToVCard('contact-a', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'FirstName', page: 1, content: 'After' },
    ],
  }, existing);
  assert.match(changed, /FN:After Name/);
  assert.match(changed, /EMAIL;TYPE=INTERNET:before@example\.test/);
  assert.match(changed, /TEL;TYPE=CELL:\+15551234567/);
  assert.match(changed, /NOTE:Private note/);
  assert.match(changed, new RegExp(`PHOTO;ENCODING=BASE64;TYPE=JPEG:${originalPicture}`));

  const replacementPicture = Buffer.from('replacement-picture').toString('base64');
  const pictureChanged = activeSyncContactApplicationDataToVCard('contact-a', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'Picture', page: 1, content: replacementPicture },
    ],
  }, changed);
  assert.doesNotMatch(pictureChanged, new RegExp(originalPicture));
  assert.match(pictureChanged, new RegExp(replacementPicture));
});

test('contact omission clears are scoped while Body and Picture stay ghosted', () => {
  const picture = Buffer.from('ghosted-picture').toString('base64');
  const existing = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:contact-ghosting', 'FN:Before Name', 'N:Name;Before;;;',
    'EMAIL;TYPE=INTERNET:before@example.test', 'ORG:Before Company', 'NOTE:Keep this note',
    `PHOTO;ENCODING=BASE64;TYPE=JPEG:${picture}`, 'END:VCARD', '',
  ].join('\r\n');
  const applicationData = { tag: 'ApplicationData', page: 0, children: [
    { tag: 'FirstName', page: 1, content: 'After' },
  ] };

  const absentSupported = activeSyncContactApplicationDataToVCard(
    'contact-ghosting', applicationData, existing, new Set(['1:CompanyName', '1:Email1Address']),
  );
  assert.doesNotMatch(absentSupported, /^EMAIL/m);
  assert.doesNotMatch(absentSupported, /^ORG/m);
  assert.match(absentSupported, /NOTE:Keep this note/);
  assert.match(absentSupported, new RegExp(picture));

  const emptySupported = activeSyncContactApplicationDataToVCard(
    'contact-ghosting', applicationData, existing, new Set(),
  );
  assert.match(emptySupported, /before@example\.test/);
  assert.match(emptySupported, /ORG:Before Company/);

  const companyOnly = activeSyncContactApplicationDataToVCard(
    'contact-ghosting', applicationData, existing, new Set(['1:CompanyName']),
  );
  assert.doesNotMatch(companyOnly, /^ORG/m);
  assert.match(companyOnly, /before@example\.test/);
});

test('partial phone changes match vCard type buckets in arbitrary TEL order', () => {
  const existing = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:phone-types', 'FN:Phone Types', 'N:Types;Phone;;;',
    'TEL;TYPE=HOME:home-one',
    'TEL;TYPE=WORK:work-one',
    'TEL;TYPE=CELL:cell-one',
    'TEL;TYPE=WORK:work-two',
    'TEL;TYPE=OTHER:other-one',
    'END:VCARD', '',
  ].join('\r\n');
  const changed = activeSyncContactApplicationDataToVCard('phone-types', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'BusinessPhoneNumber', page: 1, content: 'work-one-new' },
      { tag: 'Business2PhoneNumber', page: 1, content: 'work-two-new' },
      { tag: 'MobilePhoneNumber', page: 1, content: 'cell-new' },
    ],
  }, existing);
  const phones = changed.split(/\r?\n/).filter(line => /^TEL/i.test(line));
  assert.deepEqual(phones, [
    'TEL;TYPE=HOME:home-one',
    'TEL;TYPE=WORK;X-OMS-EAS-SLOT=BusinessPhoneNumber:work-one-new',
    'TEL;TYPE=CELL;X-OMS-EAS-SLOT=MobilePhoneNumber:cell-new',
    'TEL;TYPE=WORK;X-OMS-EAS-SLOT=Business2PhoneNumber:work-two-new',
    'TEL;TYPE=OTHER:other-one',
  ]);

  const mobileOnly = activeSyncContactApplicationDataToVCard('phone-types', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'MobilePhoneNumber', page: 1, content: 'cell-only-new' },
    ],
  }, [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:phone-types', 'FN:Phone Types', 'N:Types;Phone;;;',
    'TEL;TYPE=WORK:keep-work', 'TEL;TYPE=CELL:replace-cell', 'END:VCARD', '',
  ].join('\r\n'));
  assert.match(mobileOnly, /TEL;TYPE=WORK:keep-work/);
  assert.match(mobileOnly, /TEL;TYPE=CELL;X-OMS-EAS-SLOT=MobilePhoneNumber:cell-only-new/);
  assert.doesNotMatch(mobileOnly, /replace-cell/);
});

test('contact notes round-trip as Body data without exposing the vCard', () => {
  const vcard = activeSyncContactApplicationDataToVCard('contact-notes', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'FileAs', page: 1, content: 'Notes Contact' },
      { tag: 'Body', page: 17, children: [
        { tag: 'Type', page: 17, content: '1' },
        { tag: 'Data', page: 17, content: 'Only the private note' },
      ] },
    ],
  });
  assert.match(vcard, /NOTE:Only the private note/);

  const data = contactToActiveSyncApplicationData({ name: 'Notes Contact', vcard_data: vcard }, vcard);
  const body = data.find(node => node.tag === 'Body');
  assert.equal(body.children.find(node => node.tag === 'Data').content, 'Only the private note');
  assert.doesNotMatch(body.children.find(node => node.tag === 'Data').content, /BEGIN:VCARD/);
});

test('contact Picture uses plain base64 on the wire and rejects encoded values above 48KB', () => {
  const picture = Buffer.from('picture-bytes').toString('base64');
  const data = contactToActiveSyncApplicationData({
    name: 'Picture Contact',
    vcard_data: `BEGIN:VCARD\r\nVERSION:3.0\r\nPHOTO;ENCODING=BASE64;TYPE=JPEG:${picture}\r\nEND:VCARD\r\n`,
  });
  assert.equal(data.find(node => node.tag === 'Picture').content, picture);
  assert.equal(MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES, 48 * 1024);
  assert.throws(() => activeSyncContactApplicationDataToVCard('too-large', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'Picture', page: 1, content: 'A'.repeat(MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES + 4) },
    ],
  }), ActiveSyncContactPictureError);
  const oversizedStored = contactToActiveSyncApplicationData({
    name: 'Legacy Oversized Picture',
    photo_url: `data:image/jpeg;base64,${'A'.repeat(MAX_ACTIVE_SYNC_CONTACT_PICTURE_BYTES + 4)}`,
  });
  assert.equal(oversizedStored.some(node => node.tag === 'Picture'), false);
});

test('simultaneous explicit-empty contact fields clear every requested value', () => {
  const existing = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:clear-many', 'FN:Clear Many', 'N:Many;Clear;;;',
    'EMAIL:a@example.test', 'EMAIL:b@example.test', 'EMAIL:c@example.test',
    'TEL;TYPE=CELL:111', 'TEL;TYPE=WORK:222', 'TEL;TYPE=HOME:333', 'END:VCARD', '',
  ].join('\r\n');
  const changed = activeSyncContactApplicationDataToVCard('clear-many', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'Email1Address', page: 1, content: '' },
      { tag: 'Email2Address', page: 1, content: '' },
      { tag: 'MobilePhoneNumber', page: 1, content: '' },
      { tag: 'BusinessPhoneNumber', page: 1, content: '' },
    ],
  }, existing);
  const emailLines = changed.split(/\r?\n/).filter(line => /^EMAIL/i.test(line));
  const phoneLines = changed.split(/\r?\n/).filter(line => /^TEL/i.test(line));
  assert.deepEqual(emailLines, ['EMAIL:c@example.test']);
  assert.deepEqual(phoneLines, ['TEL;TYPE=HOME:333']);
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

test('Contacts2 and common structured fields round-trip through vCard without silent loss', () => {
  const vcard = activeSyncContactApplicationDataToVCard('structured-contact', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'FirstName', page: 1, content: 'Ada' },
      { tag: 'MiddleName', page: 1, content: 'M' },
      { tag: 'LastName', page: 1, content: 'Lovelace' },
      { tag: 'Title', page: 1, content: 'Countess' },
      { tag: 'Suffix', page: 1, content: 'III' },
      { tag: 'Department', page: 1, content: 'Research' },
      { tag: 'Birthday', page: 1, content: '1815-12-10T00:00:00.000Z' },
      { tag: 'WebPage', page: 1, content: 'https://example.test/ada' },
      { tag: 'HomeAddressStreet', page: 1, content: '1 Example Way' },
      { tag: 'HomeAddressCity', page: 1, content: 'London' },
      { tag: 'NickName', page: 12, content: 'Enchantress' },
      { tag: 'IMAddress', page: 12, content: 'ada@example.test' },
      { tag: 'ManagerName', page: 12, content: 'Charles' },
    ],
  });
  assert.match(vcard, /N:Lovelace;Ada;M;Countess;III/);
  assert.match(vcard, /ORG:;Research/);
  assert.match(vcard, /BDAY:1815-12-10/);
  assert.match(vcard, /URL:https:\/\/example\.test\/ada/);
  assert.match(vcard, /ADR;TYPE=HOME:;;1 Example Way;London;;;/);
  assert.match(vcard, /NICKNAME:Enchantress/);
  assert.match(vcard, /IMPP;X-OMS-EAS-SLOT=IMAddress:ada@example\.test/);
  assert.match(vcard, /X-OMS-MANAGER-NAME:Charles/);

  const outbound = contactToActiveSyncApplicationData({ name: 'Ada Lovelace', vcard_data: vcard }, vcard);
  const values = new Map(outbound.map(node => [`${node.page}:${node.tag}`, node.content]));
  assert.equal(values.get('1:MiddleName'), 'M');
  assert.equal(values.get('1:Department'), 'Research');
  assert.equal(values.get('1:Birthday'), '1815-12-10T00:00:00.000Z');
  assert.equal(values.get('1:HomeAddressCity'), 'London');
  assert.equal(values.get('12:NickName'), 'Enchantress');
  assert.equal(values.get('12:IMAddress'), 'ada@example.test');
  assert.equal(values.get('12:ManagerName'), 'Charles');
});

test('recognized but unsupported contact fields fail before conversion', () => {
  assert.throws(() => activeSyncContactApplicationDataToVCard('unsupported', {
    tag: 'ApplicationData', page: 0, children: [{ tag: 'Alias', page: 1, content: 'read-only' }],
  }), ActiveSyncContactFieldError);
});

test('sparse EAS phone, email, and IM slots retain their exact ordinal through vCard', () => {
  const cases = [
    ['Business2PhoneNumber', 1, 'work-second'],
    ['Home2PhoneNumber', 1, 'home-second'],
    ['RadioPhoneNumber', 1, 'radio-only'],
    ['Email2Address', 1, 'second@example.test'],
    ['Email3Address', 1, 'third@example.test'],
    ['IMAddress2', 12, 'im:second'],
    ['IMAddress3', 12, 'im:third'],
  ];
  for (const [tag, page, value] of cases) {
    const vcard = activeSyncContactApplicationDataToVCard(`sparse-${tag}`, {
      tag: 'ApplicationData', page: 0, children: [{ tag, page, content: value }],
    });
    const outbound = new Map(contactToActiveSyncApplicationData({ name: tag, vcard_data: vcard }, vcard)
      .map(node => [`${node.page}:${node.tag}`, node.content]));
    assert.equal(outbound.get(`${page}:${tag}`), value, tag);
    const family = tag.startsWith('Email') ? EMAIL_TAGS : tag.startsWith('IM') ? IM_TAGS : PHONE_TAGS;
    for (const other of family.filter(candidate => candidate !== tag)) {
      assert.equal(outbound.has(`${page}:${other}`), false, `${tag} must not compact into ${other}`);
    }
  }
});

const EMAIL_TAGS = ['Email1Address', 'Email2Address', 'Email3Address'];
const IM_TAGS = ['IMAddress', 'IMAddress2', 'IMAddress3'];
const PHONE_TAGS = [
  'MobilePhoneNumber', 'BusinessPhoneNumber', 'Business2PhoneNumber', 'HomePhoneNumber',
  'Home2PhoneNumber', 'AssistantPhoneNumber', 'RadioPhoneNumber', 'CarPhoneNumber',
  'PagerNumber', 'BusinessFaxNumber', 'HomeFaxNumber',
];

test('14.1 writable contact properties round-trip and omission clears containers', () => {
  const vcard = activeSyncContactApplicationDataToVCard('matrix-contact', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'Anniversary', page: 1, content: '2020-02-29T00:00:00.000Z' },
      { tag: 'AssistantName', page: 1, content: 'Grace' },
      { tag: 'OfficeLocation', page: 1, content: 'Building 4' },
      { tag: 'Spouse', page: 1, content: 'Chris' },
      { tag: 'YomiCompanyName', page: 1, content: 'Kaisha' },
      { tag: 'YomiFirstName', page: 1, content: 'Mei' },
      { tag: 'YomiLastName', page: 1, content: 'Li' },
      { tag: 'Categories', page: 1, children: [
        { tag: 'Category', page: 1, content: 'Customer' },
        { tag: 'Category', page: 1, content: 'Priority' },
      ] },
      { tag: 'Children', page: 1, children: [
        { tag: 'Child', page: 1, content: 'Alex' },
        { tag: 'Child', page: 1, content: 'Sam' },
      ] },
    ],
  });
  const outbound = contactToActiveSyncApplicationData({ name: 'Matrix', vcard_data: vcard }, vcard);
  const scalar = new Map(outbound.filter(node => node.content !== undefined).map(node => [node.tag, node.content]));
  assert.equal(scalar.get('Anniversary'), '2020-02-29T00:00:00.000Z');
  assert.equal(scalar.get('AssistantName'), 'Grace');
  assert.equal(scalar.get('OfficeLocation'), 'Building 4');
  assert.equal(scalar.get('Spouse'), 'Chris');
  assert.equal(scalar.get('YomiCompanyName'), 'Kaisha');
  assert.equal(scalar.get('YomiFirstName'), 'Mei');
  assert.equal(scalar.get('YomiLastName'), 'Li');
  assert.deepEqual(outbound.find(node => node.tag === 'Categories').children.map(node => node.content), ['Customer', 'Priority']);
  assert.deepEqual(outbound.find(node => node.tag === 'Children').children.map(node => node.content), ['Alex', 'Sam']);

  const cleared = activeSyncContactApplicationDataToVCard('matrix-contact', {
    tag: 'ApplicationData', page: 0, children: [{ tag: 'FirstName', page: 1, content: 'Kept' }],
  }, vcard, new Set(['1:Categories', '1:Children', '1:Spouse']));
  assert.doesNotMatch(cleared, /^(?:CATEGORIES|X-OMS-CHILD|X-OMS-SPOUSE):/m);

  assert.throws(() => activeSyncContactApplicationDataToVCard('bad-categories', {
    tag: 'ApplicationData', page: 0, children: [{ tag: 'Categories', page: 1, children: [] }],
  }), ActiveSyncContactFieldError);
  const explicitChildrenClear = activeSyncContactApplicationDataToVCard('children-clear', {
    tag: 'ApplicationData', page: 0, children: [{ tag: 'Children', page: 1, children: [] }],
  }, vcard);
  assert.doesNotMatch(explicitChildrenClear, /^X-OMS-CHILD:/m);
});

test('structured vCard parsing respects escaped and even-backslash separators', () => {
  const escaped = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:escaped', 'FN:John Doe',
    'N:Doe\\;Sr;John;;;', 'ORG:Example\\; Inc;Research',
    'ADR;TYPE=HOME:;;123 Main\\; Apt 4;Phoenix;AZ;85001;US',
    'END:VCARD', '',
  ].join('\r\n');
  const values = new Map(contactToActiveSyncApplicationData({ name: 'John Doe', vcard_data: escaped }, escaped)
    .map(node => [`${node.page}:${node.tag}`, node.content]));
  assert.equal(values.get('1:LastName'), 'Doe;Sr');
  assert.equal(values.get('1:FirstName'), 'John');
  assert.equal(values.get('1:CompanyName'), 'Example; Inc');
  assert.equal(values.get('1:Department'), 'Research');
  assert.equal(values.get('1:HomeAddressStreet'), '123 Main; Apt 4');

  const evenBackslash = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe\\\\;John;;;\r\nEND:VCARD\r\n';
  const evenValues = new Map(contactToActiveSyncApplicationData({ name: 'John Doe', vcard_data: evenBackslash }, evenBackslash)
    .map(node => [node.tag, node.content]));
  assert.equal(evenValues.get('LastName'), 'Doe\\');
  assert.equal(evenValues.get('FirstName'), 'John');
});

test('vCard categories flatten raw escaped text lists before applying the protocol cap', () => {
  const vcard = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:category-contact', 'FN:Category Contact',
    'CATEGORIES:Friend,VIP\\,Special',
    'CATEGORIES:Path\\\\,Customer',
    'END:VCARD', '',
  ].join('\r\n');
  const categories = contactToActiveSyncApplicationData({ name: 'Category Contact', vcard_data: vcard }, vcard)
    .find(node => node.tag === 'Categories');

  assert.deepEqual(categories.children.map(node => node.content), [
    'Friend', 'VIP,Special', 'Path\\', 'Customer',
  ]);

  const many = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:many-categories', 'FN:Many Categories',
    `CATEGORIES:${Array.from({ length: 130 }, (_, index) => `category-${index}`).join(',')}`,
    'END:VCARD', '',
  ].join('\r\n');
  const capped = contactToActiveSyncApplicationData({ name: 'Many Categories', vcard_data: many }, many)
    .find(node => node.tag === 'Categories');
  assert.equal(capped.children.length, 128);
  assert.equal(capped.children.at(-1).content, 'category-127');
});

test('contact structured fields reject control injection while Body preserves normalized newlines', () => {
  assert.throws(() => activeSyncContactApplicationDataToVCard('control-injection', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'FileAs', page: 1, content: 'Safe\r\nEMAIL:injected@example.test' },
    ],
  }), ActiveSyncContactFieldError);
  assert.throws(() => activeSyncContactApplicationDataToVCard('control-delete', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'FileAs', page: 1, content: `Unsafe${String.fromCharCode(127)}` },
    ],
  }), ActiveSyncContactFieldError);

  const vcard = activeSyncContactApplicationDataToVCard('multiline-note', {
    tag: 'ApplicationData', page: 0, children: [
      { tag: 'Body', page: 17, children: [
        { tag: 'Data', page: 17, content: 'first\r\nsecond\rthird\nfourth\tindented' },
      ] },
    ],
  });
  assert.match(vcard, /NOTE:first\\nsecond\\nthird\\nfourth\tindented\r\n/);
});
