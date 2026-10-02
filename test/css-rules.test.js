const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'xput.css'), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(match => match[1]).join(' ');
};

// The pixel-level checks run in a browser (ops/e2e-results.js); these keep the key numbers from drifting.
test('focus ring: keyboard only, 2px solid #1747C9, 2px offset', () => {
  assert.match(css, /:focus-visible \{ outline: 2px solid #1747C9; outline-offset: 2px; \}/);
  assert.match(css, /:focus:not\(:focus-visible\) \{ outline: none; \}/);
  assert.doesNotMatch(css, /:focus \{[^}]*outline: [1-9]/, 'no ring on plain :focus');
});

test('download buttons: at least 56px tall with no fixed size; the size never wraps', () => {
  const dl = rule('.dl');
  assert.match(dl, /min-height: 56px/);
  assert.doesNotMatch(dl, /(?:^|[\s;])(?:height|width):\s*\d+px/);
  assert.match(rule('.dl__size'), /white-space: nowrap/);
  assert.match(rule('.dl__label'), /overflow-wrap: anywhere/);
});

test('result card: two-line text clamp, 50vh preview cap, 340px thumbnail column and 400px portrait cap on computers', () => {
  assert.match(rule('.rcard__text'), /-webkit-line-clamp: 2/);
  assert.match(rule('.preview'), /width: min\(100%, calc\(50vh \* var\(--rnum/);
  assert.match(css, /\.block--video, \.block--gif \{\s*display: grid; grid-template-columns: 340px minmax\(0, 1fr\)/);
  assert.match(css, /width: min\(340px, calc\(400px \* var\(--rnum/);
  assert.match(css, /\.block--video \.toggle, \.block--gif \.toggle \{ margin-top: 4px; \}/);
});

test('download dialog: 600px wide, at most 80vh, fixed header and footer around a scrolling list; 72px thumbnails', () => {
  assert.match(css, /\.sheet \{ display: flex; flex-direction: column; max-height: 80vh;/);
  assert.match(css, /\.sheet \{ width: min\(600px, calc\(100vw - 48px\)\);/);
  assert.match(rule('.sheet__body'), /overflow-y: auto/);
  assert.match(rule('.thumb'), /width: 72px; height: 72px/);
});
