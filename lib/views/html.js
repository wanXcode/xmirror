// Tiny HTML templating: interpolated values are escaped unless wrapped in raw()
// or produced by html``. Arrays are flattened; null/undefined/false render nothing.
class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ESCAPES[char]);
}

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

function raw(value) {
  return new SafeHtml(String(value));
}

// JSON for <script type="application/ld+json">: "<" must not be able to close the tag.
function jsonForScript(value) {
  return raw(JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}

module.exports = { SafeHtml, escapeHtml, html, jsonForScript, raw, render };
