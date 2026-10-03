const { raw } = require('../html');

// Inline SVG illustrations (from the design boards). Decorative: aria-hidden.
const BASE = '<ellipse cx="90" cy="108" rx="70" ry="8" fill="#F1E6D6"/><rect x="58" y="10" width="64" height="96" rx="12" fill="#FFFFFF" stroke="#1F1A14" stroke-width="2.5"/><rect x="66" y="22" width="48" height="34" rx="6" fill="#FFC9A6"/><rect x="66" y="62" width="34" height="5" rx="2.5" fill="#E8DCCB"/><rect x="66" y="72" width="26" height="5" rx="2.5" fill="#E8DCCB"/><circle cx="132" cy="70" r="20" fill="#1747C9"/><path d="M30 30l4 4M34 30l-4 4M146 18l3 3M149 18l-3 3" stroke="#FF8A4C" stroke-width="2.5" stroke-linecap="round"/><circle cx="40" cy="80" r="4" fill="#FF8A4C"/>';

const PLAY = '<path d="M85 33v12l10-6z" fill="#1F1A14"/>';
const ARROW = '<path d="M132 60v18M125 72l7 7 7-7" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
const EYE = '<path d="M72 39s6-8 18-8 18 8 18 8-6 8-18 8-18-8-18-8z" fill="none" stroke="#1F1A14" stroke-width="2.2"/><circle cx="90" cy="39" r="4" fill="#1F1A14"/>';
const CHECK = '<path d="M124 70l5 5 11-11" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

const draw = (inner, width = 200) =>
  raw(`<svg class="illustration" width="${width}" height="${Math.round(width * 0.665)}" viewBox="0 0 180 120" aria-hidden="true" focusable="false">${BASE}${inner}</svg>`);

module.exports = {
  // Download tool: phone with a play button and a download badge.
  download: (width) => draw(PLAY + ARROW, width),
  // Viewer: phone with an eye and a check badge.
  read: (width) => draw(EYE + CHECK, width)
};
