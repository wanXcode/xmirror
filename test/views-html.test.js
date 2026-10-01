const test = require('node:test');
const assert = require('node:assert/strict');
const { html, raw, escapeHtml, jsonForScript } = require('../lib/views/html');

test('html`` escapes interpolated values but not its own markup', () => {
  const evil = '<script>alert("x")</script> & \'q\'';
  assert.equal(String(html`<p title="${evil}">${evil}</p>`), '<p title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
});

test('nested templates, arrays and raw() are not escaped twice; empty values render nothing', () => {
  const item = text => html`<li>${text}</li>`;
  assert.equal(String(html`<ul>${['a', '<b>'].map(item)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${raw('<i>ok</i>')}${null}${undefined}${false}${true}${0}`), '<i>ok</i>0');
  assert.equal(escapeHtml(12), '12');
});

test('jsonForScript cannot terminate its script element or break on line separators', () => {
  const out = String(jsonForScript({ a: '</script><b>', b: '  ' }));
  assert.doesNotMatch(out, /<\/script>|<b>/);
  assert.deepEqual(JSON.parse(out), { a: '</script><b>', b: '  ' });
});
