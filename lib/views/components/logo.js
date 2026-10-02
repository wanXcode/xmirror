const { html, raw } = require('../html');

// Logo B: blue rounded square, white X, orange tray (same artwork as public/xput-logo.svg).
// The mark is decorative; the link around it carries the accessible name.
function logoMark(size = 32) {
  return html`<span class="brand__mark" style="--size:${size}px">${raw('<svg width="100%" height="100%" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect x="4" y="4" width="92" height="92" rx="22" fill="#1747C9"/><path d="M34 24 66 56M66 24 34 56" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="M20 62v14c0 4 3 7 7 7h46c4 0 7-3 7-7V62" fill="none" stroke="#FF8A4C" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>')}</span>`;
}

module.exports = { logoMark };
