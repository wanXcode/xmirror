const { html } = require('../html');

// Minimal page body used until a page's real template lands. It already carries
// the page's H1 so the shared shell (head, hreflang, header, footer) can be checked.
function renderShell({ t, page }) {
  return html`<div class="container"><h1 class="shell-title">${t(`pages.${page}.h1`)}</h1></div>`;
}

module.exports = { renderShell };
