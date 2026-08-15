const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the HTTP listener waits for the required calendar identity migration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.ok(
    /async function startServer\(\)[\s\S]*?await startApplicationAfterRequiredMigrations\([\s\S]*?ensureCalendarSchema[\s\S]*?listen:[\s\S]*?server\.listen\(/.test(source),
    'the backend must use the executable required-migration startup gate',
  );
  assert.doesNotMatch(
    source,
    /ensureCalendarSchema\(\)\.catch\([^;]+console\.error/,
    'calendar schema failure must not be reduced to a log while serving continues',
  );
});

test('the HTTP listener waits for the required Notes schema migration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const startup = source.slice(source.indexOf('async function startServer()'));
  assert.match(
    startup,
    /startApplicationAfterRequiredMigrations\([\s\S]*?ensureNotesSchema[\s\S]*?ensureRemindersSchema[\s\S]*?ensureAttachmentsSchema[\s\S]*?listen:/,
    'Notes, reminder, and attachment schemas must finish successfully inside the startup gate before the backend listens',
  );
  assert.doesNotMatch(
    source,
    /ensureNotesSchema\(\)\.catch\([^;]+console\.error/,
    'Notes schema failure must not be reduced to a log while serving continues',
  );
  assert.doesNotMatch(
    source,
    /ensure(?:Reminders|Attachments)Schema\(\)\.catch\([^;]+console\.error/,
    'dependent Notes schema failures must not be reduced to a log while serving continues',
  );
});

test('the HTTP listener repairs managed birthday projections before accepting traffic', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const startup = source.slice(source.indexOf('async function startServer()'));
  assert.match(
    startup,
    /startApplicationAfterRequiredMigrations\([\s\S]*?ensureContactsSchema[\s\S]*?repairBirthdayCalendarProjections: repairAllBirthdayCalendarProjections[\s\S]*?listen:/,
    'contact schema and birthday projection repair must complete before the backend listens',
  );
  assert.doesNotMatch(
    source,
    /ensureContactsSchema\(\)\.catch\([^;]+console\.error/,
    'contact schema failure must not be reduced to a log while serving continues',
  );
});
