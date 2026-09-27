const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');
function render(html, blocks, legacy = false) {
  const { document, NodeFilter } = parseHTML(`<html><body><div id="originContent">${html}</div></body></html>`);
  Object.defineProperty(document, 'readyState', { value: 'loading' });
  const context = vm.createContext({ document, NodeFilter: NodeFilter || { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../public/mirror-page'), 'utf8'), context);
  const result = context.module.exports[legacy ? 'renderTranslatedBlocks' : 'renderTranslationTask']({ blocks });
  const out = document.createElement('div'); out.innerHTML = result; return out;
}
for (const legacy of [false, true]) {
  test(`all three br-separated paragraphs survive (${legacy ? 'cache' : 'task'})`, () => {
    const out = render('one<br>two<br>three<img src="/images/a.png">', ['甲','乙','丙'].map(text => ({ text, status: 'completed' })), legacy);
    assert.equal(out.textContent, '甲乙丙');
    assert.equal(out.querySelector('img').getAttribute('src'), '/images/a.png');
  });
}
test('mixed root text, heading, paragraph and media retain order and pending text', () => {
  const out = render('one<br><img src="/images/a.png"><h2>two</h2><p>three</p><img src="/images/b.png">', [
    { text:'甲', status:'completed' }, { text:'乙', status:'completed' }, { text:'three',status:'queued' }
  ]);
  assert.deepEqual([...out.querySelectorAll('img')].map(x => x.getAttribute('src')), ['/images/a.png','/images/b.png']);
  assert.equal(out.querySelector('h2').textContent, '乙');
  assert.match(out.querySelector('p').textContent, /three.*待翻译/);
  assert.match(out.innerHTML, /甲.*a.png.*乙.*three.*b.png/);
});
test('line breaks inside semantic paragraphs keep every translated line', () => {
  const out = render('<p>one<br>two</p><p>three</p>', [
    { text: '甲\n乙', status: 'completed' }, { text: '丙', status: 'completed' }
  ]);
  assert.equal(out.textContent, '甲乙丙');
});
