const { html, jsonForScript } = require('../html');
const icons = require('./icons');
const illustrations = require('./illustrations');

// Client strings the finder script needs; everything else is in the markup.
const CLIENT_KEYS = ['paste', 'pasteFailed', 'errEmpty', 'errInvalid', 'errNotSingle', 'loadingNote', 'fetching', 'saving',
  'clipboardFound', 'clipboardFill', 'unavailable', 'rejected', 'busy', 'tooMany', 'sensitive', 'saved', 'result', 'download', 'view', 'viewPost'];

/**
 * The link box: input + Paste, then the actions, and an area (data-panel) that
 * starts with the server-rendered empty state and is driven by finder.js.
 * mode 'home' has Download (primary) and View; 'viewer' has only View post.
 */
function renderFinder({ t, lang, mode, empty }) {
  const input = Object.fromEntries(CLIENT_KEYS.map(key => [key, t(`input.${key}`)]));
  const config = { mode, lang, input, endpoints: { resolve: '/api/resolve', archive: '/api/archive', savedCopy: '/api/saved-copy', ageConfirm: '/api/age-confirm' } };
  const home = mode === 'home';

  return html`<section class="finder" data-finder data-mode="${mode}" data-state="idle" aria-label="${t('input.label')}">
  <form class="finder__form" novalidate>
    <div class="finder__card"><div class="finder__row">
      <div class="finder__field">
        <input class="finder__input" id="finder-input" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="${t('input.label')}" placeholder="${t('input.placeholder')}" data-input>
        <button class="chip-button" type="button" data-action="paste">${t('input.paste')}</button>
      </div>
      <div class="finder__actions">
        ${home ? html`<button class="btn btn--primary" type="submit" data-action="download">${icons.download(18)}<span class="btn__label">${t('input.download')}</span></button>` : ''}
        ${home
    ? html`<button class="btn btn--outline" type="button" data-action="view"><span class="btn__label">${t('input.view')}</span></button>`
    : html`<button class="btn btn--primary" type="submit" data-action="view">${icons.eye(18)}<span class="btn__label">${t('input.viewPost')}</span></button>`}
      </div>
    </div></div>
    <button class="finder__clipboard" type="button" data-clipboard hidden>${icons.clipboard(16)}<span>${t('input.clipboardFound')} <strong>${t('input.clipboardFill')}</strong></span></button>
    <p class="finder__message" id="finder-message" role="alert" data-message hidden></p>
  </form>
  <div class="finder__panel" data-panel aria-live="polite">${empty}</div>
  <template data-saving-art>${illustrations.read(150)}</template>
  <script type="application/json" data-finder-config>${jsonForScript(config)}</script>
</section>`;
}

module.exports = { renderFinder };
