const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderDocument } = require('../lib/views/layout');
const { html } = require('../lib/views/html');

test('every page advertises the shared site icons, and the files exist', () => {
  const projectRoot = path.join(__dirname, '..');
  const generated = String(renderDocument({ lang: 'en', baseUrl: 'https://xput.app', page: 'home', title: 't', body: html`<h1>x</h1>` }));
  const staticPages = ['admin-xput.html', 'help.html', 'report.html'].map(name => fs.readFileSync(path.join(projectRoot, 'public', name), 'utf8'));
  for (const markup of [generated, ...staticPages]) {
    assert.ok(markup.includes('href="/favicon.svg?v=xput-tray-1"'));
    assert.ok(markup.includes('href="/favicon.ico?v=xput-tray-1"'));
    assert.ok(markup.includes('href="/apple-touch-icon.png?v=xput-tray-1"'));
    assert.ok(markup.includes('href="/site.webmanifest?v=xput-tray-1"'));
  }
  for (const asset of ['favicon.svg', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'favicon-192x192.png', 'favicon-512x512.png', 'safari-pinned-tab.svg']) {
    assert.equal(fs.existsSync(path.join(projectRoot, 'public', asset)), true, `${asset} should exist`);
  }
});
