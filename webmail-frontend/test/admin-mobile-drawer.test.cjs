const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routesSource = fs.readFileSync(
  path.join(__dirname, '../src/admin/routes.tsx'),
  'utf8',
);

test('mobile Admin navigation uses an opaque, labelled drawer', () => {
  assert.match(routesSource, /id="admin-navigation"/);
  assert.match(routesSource, /aria-label="Admin sections"/);
  assert.match(routesSource, /aria-expanded=\{sidebarOpen\}/);
  assert.match(routesSource, /aria-controls="admin-navigation"/);
  assert.match(routesSource, /aria-label="Close Admin menu"/);
  assert.match(
    routesSource,
    /@media \(max-width: 768px\)[\s\S]*\.admin-sidebar\s*\{[\s\S]*background:\s*var\(--surface-color\)\s*!important/,
  );
  assert.match(
    routesSource,
    /\.admin-sidebar\s*\{[\s\S]*visibility:\s*hidden[\s\S]*\.admin-sidebar\.open\s*\{[\s\S]*visibility:\s*visible/,
  );
  assert.match(
    routesSource,
    /\.admin-sidebar\s*\{[\s\S]*box-shadow:\s*8px 0 28px rgba\(0, 0, 0, 0\.36\)/,
  );
});
