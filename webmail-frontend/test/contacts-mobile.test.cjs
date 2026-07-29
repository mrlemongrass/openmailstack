const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contactsLayoutSource = fs.readFileSync(
  path.join(__dirname, '../src/contacts/ContactsLayout.tsx'),
  'utf8',
);
const contactGridSource = fs.readFileSync(
  path.join(__dirname, '../src/contacts/ContactGrid.tsx'),
  'utf8',
);

test('mobile contacts use one column and expose the contact editor', () => {
  assert.match(
    contactGridSource,
    /const cols = isMobile \? 1 : 3;/,
    'mobile contacts should render a single card per row',
  );
  assert.match(
    contactGridSource,
    /isMobile \? 90/,
    'mobile virtualized rows should start with a compact single-column estimate',
  );
  assert.match(
    contactGridSource,
    /ref=\{virtualizer\.measureElement\}[\s\S]*data-index=\{vr\.index\}[\s\S]*paddingBottom: isListMode \? 8 : 16/,
    'virtualized rows should measure their actual rendered height and retain row spacing',
  );
  assert.match(
    contactGridSource,
    /isMobile && onNewContact[\s\S]*New Contact/,
    'mobile contacts should provide a visible New Contact action',
  );
  assert.match(
    contactsLayoutSource,
    /<ContactGrid contacts=\{contacts\} density=\{density\} isMobile onNewContact=\{handleNewContact\} \/>[\s\S]*\{contactEditor\}/,
    'the mobile list should open and render the contact editor',
  );
});
