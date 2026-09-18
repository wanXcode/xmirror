const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('triple-click delete modal requests a password without embedding or storing it', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');

  assert.match(html, /id="deletePassword"\s+type="password"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.doesNotMatch(html, /id="deletePassword"[^>]+value=/);
  assert.match(script, /'x-admin-token': password/);
  assert.match(script, /if \(count >= 3\)/);
  assert.doesNotMatch(script, /localStorage[^\n]*deletePassword/i);
});
