const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const hookSource = read('src/shared/hooks/useModalFocus.ts');
const composeSource = read('src/mail/ComposeModal.tsx');
const calendarSource = read('src/calendar/EventModal.tsx');
const contactsSource = read('src/contacts/ContactEditModal.tsx');
const schedulerSource = read('src/scheduler/routes.tsx');
const confirmSource = read('src/shared/components/ConfirmDialog.tsx');

test('shared modal focus hook traps focus, isolates background, and restores focus', () => {
  assert.match(hookSource, /export function useModalFocus/);
  assert.match(hookSource, /sibling\.inert = true/);
  assert.match(hookSource, /sibling\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(hookSource, /event\.key === 'Escape'/);
  assert.match(hookSource, /event\.key !== 'Tab'/);
  assert.match(hookSource, /returnFocus\.focus\(\)/);
});

test('Compose, Calendar, Contacts, and Scheduler use one modal focus contract', () => {
  for (const source of [composeSource, calendarSource, contactsSource, schedulerSource]) {
    assert.match(source, /useModalFocus/);
    assert.doesNotMatch(source, /const focusable = Array\.from/);
  }
});

test('Scheduler booking details and shared confirmations are labelled modal dialogs', () => {
  assert.match(schedulerSource, /role="dialog" aria-modal="true" aria-labelledby="booking-detail-title"/);
  assert.match(schedulerSource, /aria-label="Close booking details"/);
  assert.match(confirmSource, /role="dialog"/);
  assert.match(confirmSource, /aria-modal="true"/);
  assert.match(confirmSource, /aria-labelledby="confirm-dialog-title"/);
});
