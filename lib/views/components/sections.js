const { html } = require('../html');
const icons = require('./icons');

// Page sections shared by the home and viewer templates. All text arrives
// already translated, so these only decide markup.

const STEP_ICONS = [icons.link, icons.clipboard, icons.download];

function heading(h1) {
  return html`<h1 class="hero__title">${h1.plain}<span class="mark">${h1.mark}</span></h1>`;
}

function hero({ badge, h1, subtitle }) {
  return html`<div class="hero">
  <span class="badge">${badge}</span>
  ${heading(h1)}
  <p class="hero__subtitle">${subtitle}</p>
</div>`;
}

function prose(paragraphs) {
  return paragraphs.map(text => html`<p class="prose">${text}</p>`);
}

function steps({ h2, items, notes, icons: stepIcons = STEP_ICONS }) {
  return html`<section class="section" aria-labelledby="steps-h2">
  <h2 id="steps-h2" class="section__title">${h2}</h2>
  <ol class="steps">${items.map((item, index) => html`<li class="step"><span class="icon-tile icon-tile--step">${stepIcons[index](22)}<span class="step__number" aria-hidden="true">${index + 1}</span></span><div><h3>${item.title}</h3><p>${item.text}</p></div></li>`)}</ol>
  ${prose(notes)}
</section>`;
}

function featureGrid({ id, h2, items, notes = [], icon, columns = 4 }) {
  return html`<section class="section" aria-labelledby="${id}">
  <h2 id="${id}" class="section__title">${h2}</h2>
  <div class="features features--${columns}">${items.map((item, index) => html`<div class="feature"><span class="icon-tile">${icon[index](20)}</span><div><h3>${item.title}</h3><p>${item.text}</p></div></div>`)}</div>
  ${prose(notes)}
</section>`;
}

function platformGuide({ h2, intro, iphone, android, note, shortcutHref }) {
  const card = (data, link) => html`<div class="platform"><div class="platform__head"><span class="icon-tile icon-tile--small">${icons.phone(20)}</span><h3>${data.title}</h3></div><ol>${data.steps.map(step => html`<li>${step}</li>`)}</ol>${link}</div>`;
  return html`<section class="section" aria-labelledby="phones-h2">
  <h2 id="phones-h2" class="section__title">${h2}</h2>
  <p class="prose">${intro}</p>
  <div class="platforms">
    ${card(iphone, html`<a class="text-link" href="${shortcutHref}">${iphone.link}</a>`)}
    ${card(android, '')}
  </div>
  <p class="prose">${note}</p>
</section>`;
}

function banner({ eyebrow, title, text, cta, href, icon }) {
  return html`<aside class="banner">
  <span class="banner__circle" aria-hidden="true"></span>
  <div class="banner__copy"><span class="banner__eyebrow">${eyebrow}</span><p class="banner__title">${title}</p><p class="banner__text">${text}</p></div>
  <a class="banner__cta" href="${href}">${icon(18)}${cta}</a>
</aside>`;
}

// Every answer is in the HTML source; <details open> matches the design, and
// readers can fold items away. The +/− marker is drawn by CSS.
function faq({ h2, items }) {
  return html`<section class="section section--faq" aria-labelledby="faq-h2">
  <h2 id="faq-h2" class="section__title">${h2}</h2>
  <div class="faq">${items.map(item => html`<details open><summary><span>${item.q}</span></summary><p>${item.a}</p></details>`)}</div>
</section>`;
}

module.exports = { banner, faq, featureGrid, hero, platformGuide, prose, steps };
