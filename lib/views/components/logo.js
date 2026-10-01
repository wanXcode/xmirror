const { html } = require('../html');

// The mark is decorative; the link around it carries the accessible name.
function logoMark(size = 32) {
  return html`<span class="brand__mark" style="--size:${size}px"><svg width="${Math.round(size * 0.53)}" height="${Math.round(size * 0.53)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 5l12 12M18 5L6 17"/></svg><span class="brand__dot"></span></span>`;
}

module.exports = { logoMark };
