const { html, jsonForScript } = require('../html');
const { fill } = require('../../text');
const { siteSettings } = require('../../site');

// Report / removal request. The form works with the script (public/js/report.js); /api/reports is unchanged.
function renderReport({ t }) {
  const page = t('pages.report');
  const form = page.form;
  const time = page.time;
  const { contactEmail } = siteSettings();
  const email = contactEmail ? html`<a class="text-link" href="mailto:${contactEmail}">${contactEmail}</a>` : '';
  const config = { messages: page.result, sending: form.sending, submit: form.submit, reasons: form.reasons.map(({ value, kind }) => ({ value, kind })) };

  return html`<div class="page page--report">
  <div class="report">
    <div class="report__main">
      <h1 class="report__title">${page.h1}</h1>
      <p class="report__intro">${fill(page.intro, { time })}${contactEmail ? html` ${fill(page.contactEmailLine, { email: '\u0000' }).split('\u0000').flatMap((part, index, all) => (index < all.length - 1 ? [part, email] : [part]))}` : ''}</p>
      <form class="report__form" id="report-form" novalidate data-report-form>
        <label class="field"><span class="field__label">${form.link}</span>
          <input class="field__input" name="url" type="text" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="300" placeholder="${form.linkPlaceholder}"></label>
        <fieldset class="field field--radios"><legend class="field__label">${form.reason}</legend>
          ${form.reasons.map((reason, index) => html`<label class="radio"><input type="radio" name="reason" value="${reason.value}"${index === 0 ? ' checked' : ''}><span>${reason.label}</span></label>`)}
        </fieldset>
        <label class="field"><span class="field__label">${form.email}</span>
          <input class="field__input" name="contact" type="email" autocomplete="email" required maxlength="254" placeholder="${form.emailPlaceholder}"></label>
        <label class="field"><span class="field__label">${form.details}</span>
          <textarea class="field__input field__input--area" name="details" rows="4" maxlength="1800" placeholder="${form.detailsPlaceholder}"></textarea></label>
        <label class="field field--trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="confirm" required><span>${form.confirm}</span></label>
        <button class="btn btn--primary report__submit" type="submit" data-submit>${form.submit}</button>
        <p class="report__status" role="status" aria-live="polite" data-status></p>
      </form>
    </div>
    <aside class="report__aside"><div class="next"><h2 class="next__title">${page.next.title}</h2>
      <ol class="next__list">${page.next.items.map(item => html`<li>${fill(item, { time })}</li>`)}</ol></div></aside>
  </div>
  <script type="application/json" data-report-config>${jsonForScript(config)}</script>
</div>`;
}

module.exports = { renderReport };
