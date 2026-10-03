const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const en = require('../lib/content/en');
const zh = require('../lib/content/zh');

// Page copy must match the design boards word for word (DESIGN-SPEC: "all copy follows the boards").
// If a designer updates a board, this test names the string that drifted.
const BOARDS = path.join(__dirname, '..', 'docs', 'design', 'artboards');
const normalize = value => String(value).replace(/\s+/g, ' ').trim();

function boardTexts(files) {
  const texts = new Set();
  for (const file of files) {
    const { document } = parseHTML(fs.readFileSync(path.join(BOARDS, `${file}.dc.html`), 'utf8'));
    document.querySelectorAll('style, script').forEach(node => node.remove());
    const walker = [document.documentElement];
    while (walker.length) {
      const node = walker.pop();
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { const text = normalize(child.nodeValue); if (text) texts.add(text); }
        else if (child.nodeType === 1) walker.push(child);
      }
      for (const attr of ['placeholder', 'aria-label']) if (node.getAttribute?.(attr)) texts.add(normalize(node.getAttribute(attr)));
    }
  }
  return texts;
}

function leaves(node, prefix = '') {
  if (typeof node === 'string') return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((item, i) => leaves(item, `${prefix}[${i}]`));
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

// Strings that are not on a board: SEO metadata comes from the spec text, the rest was added
// by development where the boards have no equivalent (flagged for design review).
const NOT_ON_BOARDS = [
  /\.(title|description)$/,
  /^input\.(errEmpty|pasteFailed|result\.|rejected\.|unavailable\.textNoCopy|saved\.(already|note)$|tooMany\.retryIn|tooMany\.retry$|sensitive\.text(Download|View)$|sensitive\.title$|label|viewPost)/
];

const cases = [
  ['en', en, ['W_Home_D', 'W_Home_M', 'W_Viewer_D', 'W_Viewer_M', 'W_States_D', 'W_States_M', 'W_ViewerStates_D', 'W_ViewerStates_M']],
  ['zh', zh, ['W_HomeZH_D', 'W_HomeZH_M', 'W_ViewerZH_D', 'W_ViewerZH_M']]
];

for (const [name, content, files] of cases) {
  test(`${name}: home and viewer copy matches the design boards`, () => {
    const texts = boardTexts(files);
    const strings = [...leaves(content.pages.home, 'pages.home'), ...leaves(content.pages.viewer, 'pages.viewer')];
    // zh states have no boards (English only), so only the page copy is compared for zh.
    if (name === 'en') strings.push(...leaves(content.input, 'input'));
    const missing = strings
      .filter(([key]) => !NOT_ON_BOARDS.some(pattern => pattern.test(key)))
      .filter(([, value]) => value.trim() !== '')
      .filter(([, value]) => !texts.has(normalize(value)))
      .map(([key, value]) => `${key}: ${normalize(value).slice(0, 80)}`);
    assert.deepEqual(missing, []);
  });
}
