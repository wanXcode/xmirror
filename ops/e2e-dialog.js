// Download dialog, keyboard/focus and long-text checks for ops/e2e-results.js.
const path = require('node:path');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

module.exports = async function dialogChecks({ browser, base, OUT, prepare, check, assert, inView, payloads }) {
  const { base_, LANDSCAPE, GIF, img } = payloads;
  const cases = {
    single: { code: 'DRW001', data: { ...base_(), videos: [LANDSCAPE] }, items: 1, rows: ['row--video'], count: '' },
    mixed: { code: 'DRW002', data: { ...base_(), videos: [LANDSCAPE], gifs: [GIF], images: [img(1), img(2)] }, items: 4, rows: ['row--video', 'row--gif', 'row--photos'], count: '· 4 items' },
    photos: { code: 'DRW003', data: { ...base_(), images: [1, 2, 3, 4].map(img) }, items: 4, rows: ['row--photos'], count: '' }
  };

  const open = async (vp, name, long) => {
    const mobile = vp.width < 500;
    const context = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? MOBILE_UA : undefined });
    const c = cases[name];
    const page = await prepare(context, c.data);
    await page.goto(`${base}/${c.code}`);
    if (process.env.E2E_DEBUG) { await page.screenshot({ path: path.join(OUT, 'debug-' + name + '.png') }); console.log(name, await page.locator('[data-open-drawer]').count()); }
    return { context, page, c, mobile };
  };
  const state = page => page.evaluate(() => {
    const q = s => document.querySelector(s);
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const sheet = q('[data-sheet]');
    const active = document.activeElement;
    return {
      hidden: sheet.hidden, sheet: rect(sheet), head: rect(q('.sheet__head')), body: rect(q('.sheet__body')), foot: rect(q('.sheet__foot')),
      bodyScroll: { scrollHeight: q('.sheet__body').scrollHeight, clientHeight: q('.sheet__body').clientHeight },
      title: q('#sheet-title').textContent.replace(/\s+/g, ' ').trim(), activeInSheet: !!active && sheet.contains(active), activeClass: active ? active.className : '',
      activeIsOpener: active === q('[data-open-drawer]'), rows: [...document.querySelectorAll('.sheet__body .row')].map(r => r.className.split(' ')[1]),
      thumb: rect(q('.sheet__body .thumb')), dl: rect(q('.sheet__body .row .dl')), vh: window.innerHeight, vw: window.innerWidth
    };
  });

  for (const [vp, label] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
    for (const name of Object.keys(cases)) {
      const { context, page, c, mobile } = await open(vp, name);
      const tag = `dialog-${name}-${label}`;
      await page.focus('[data-open-drawer]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sheet__body .row .dl');
      await page.waitForFunction(() => document.querySelector('.sheet__body .dl__size')?.textContent || document.querySelector('.row--photos'));
      await page.waitForTimeout(300);
      const s = await state(page);
      await page.screenshot({ path: path.join(OUT, `${tag}.png`) });

      check(`${tag}: opens with the keyboard; initial focus is the first download button, inside the dialog`, () => { assert.equal(s.hidden, false); assert.ok(s.activeInSheet); assert.ok(/\bdl\b/.test(s.activeClass), s.activeClass); });
      check(`${tag}: one compact row per media type (${c.rows.join(', ')})`, () => assert.deepEqual(s.rows, c.rows));
      check(`${tag}: title ${c.count ? `shows "${c.count}"` : 'has no count'}`, () => assert.equal(s.title, c.count ? `Download media ${c.count}` : 'Download media'));
      check(`${tag}: ${mobile ? 'bottom drawer, at most 80vh' : 'dialog is 600px wide, at most 80vh'}`, () => {
        assert.ok(s.sheet.height <= s.vh * 0.8 + 1, `height ${s.sheet.height}`);
        if (mobile) { assert.ok(Math.abs(s.sheet.width - s.vw) <= 1); assert.ok(Math.abs(s.sheet.bottom - s.vh) <= 1); } else assert.ok(Math.abs(s.sheet.width - 600) <= 1, `width ${s.sheet.width}`);
      });
      if (name !== 'photos') {
        check(`${tag}: thumbnails are 72px`, () => { assert.ok(Math.abs(s.thumb.width - 72) <= 1 && Math.abs(s.thumb.height - 72) <= 1); });
        check(`${tag}: ${mobile ? 'the button sits on its own full row under the thumbnail' : 'the button is on the right of the row'}`, () => {
          if (mobile) assert.ok(s.dl.y >= s.thumb.bottom - 1 && s.dl.width > s.sheet.width * 0.8); else assert.ok(s.dl.x > s.thumb.x + 72);
        });
      }

      // Tab stays inside, wraps in both directions
      const inside = async () => (await state(page)).activeInSheet;
      let always = true;
      for (let i = 0; i < 14; i += 1) { await page.keyboard.press('Tab'); if (!(await inside())) always = false; }
      for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) always = false; }
      check(`${tag}: Tab / Shift+Tab never leave the dialog`, () => assert.ok(always));
      const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset }; });
      check(`${tag}: keyboard focus shows the 2px #1747C9 ring with a 2px offset`, () => assert.deepEqual(ring, { style: 'solid', width: '2px', color: 'rgb(23, 71, 201)', offset: '2px' }));

      if (name === 'photos') {
        await page.click('.sheet__body .thumb--photo:nth-child(2)');
        await page.click('.sheet__body .thumb--photo:nth-child(4)');
        const t = await page.evaluate(() => ({ count: document.querySelector('.row__count').textContent, btn: document.querySelector('.row--photos .dl__label').textContent }));
        check(`${tag}: ticking thumbnails updates "N selected" and the button`, () => { assert.equal(t.count, '2 selected'); assert.equal(t.btn, mobile ? 'Save 2 to Photos' : 'Download 2 (ZIP)'); });
        await page.screenshot({ path: path.join(OUT, `${tag}-2of4.png`) });
      }

      // closing: Esc, close button, overlay all return focus to "Download media"
      for (const how of ['Escape', 'close button', 'overlay']) {
        if (how === 'Escape') await page.keyboard.press('Escape');
        else if (how === 'close button') await page.click('[data-sheet-close]');
        else await page.mouse.click(5, 5);
        await page.waitForTimeout(100);
        const after = await state(page);
        check(`${tag}: ${how} closes the dialog and focus returns to "Download media"`, () => { assert.equal(after.hidden, true); assert.ok(after.activeIsOpener); });
        if (how !== 'overlay') { await page.focus('[data-open-drawer]'); await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
      }
      await context.close();
    }
  }

  // The list scrolls inside the dialog while the header and footer stay put.
  {
    const { context, page } = await open({ width: 1440, height: 560 }, 'mixed');
    await page.click('[data-open-drawer]');
    await page.waitForSelector('.sheet__body .row .dl');
    await page.waitForTimeout(300);
    const before = await state(page);
    await page.evaluate(() => { document.querySelector('.sheet__body').scrollTop = 9999; });
    const after = await state(page);
    await page.screenshot({ path: path.join(OUT, 'dialog-mixed-desktop-short-screen-scrolled.png') });
    check('dialog (short screen): the list scrolls inside, header and footer stay fixed, height capped at 80vh', () => {
      assert.ok(before.bodyScroll.scrollHeight > before.bodyScroll.clientHeight, JSON.stringify(before.bodyScroll));
      assert.ok(before.sheet.height <= 560 * 0.8 + 1);
      assert.equal(Math.round(after.head.y), Math.round(before.head.y)); assert.equal(Math.round(after.foot.y), Math.round(before.foot.y));
    });
    await context.close();
  }

  // Long labels: +30% text wraps instead of being cut off, at normal and very narrow widths.
  for (const [vp, where] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 320, height: 640 }, 'narrow phone'], [{ width: 1440, height: 900 }, 'desktop']]) {
    const { context, page } = await open(vp, 'mixed');
    await page.click('[data-open-drawer]');
    await page.waitForSelector('.sheet__body .row .dl');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      for (const label of document.querySelectorAll('.sheet__body .dl__label')) {
        const original = label.textContent;
        label.textContent = `${original} ${original.split(' ').slice(0, 2).join(' ')}`.slice(0, Math.ceil(original.length * 1.3) + 12);
      }
      document.querySelector('.sheet__body .dl__size')?.append('');
    });
    const fit = await page.evaluate(() => [...document.querySelectorAll('.sheet__body .dl')].map(button => {
      const b = button.getBoundingClientRect(); const l = button.querySelector('.dl__label').getBoundingClientRect(); const size = button.querySelector('.dl__size')?.getBoundingClientRect();
      const lc = getComputedStyle(button.querySelector('.dl__label'));
      return { text: button.querySelector('.dl__label').textContent, buttonOk: button.scrollWidth <= button.clientWidth + 1, labelInside: l.left >= b.left - 0.5 && l.right <= b.right + 0.5 && l.bottom <= b.bottom + 0.5 && l.top >= b.top - 0.5,
        sizeInside: !size || !button.querySelector('.dl__size').textContent || size.width === 0 || size.right <= b.right + 0.5, clipped: lc.textOverflow === 'ellipsis' || lc.overflow === 'hidden', minHeight: parseFloat(getComputedStyle(button).minHeight), height: b.height, noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
    }));
    await page.screenshot({ path: path.join(OUT, `dialog-long-text-${where.replace(' ', '-')}.png`) });
    check(`long text +30% (${where}, dialog): labels wrap, nothing is cut off, no horizontal scroll`, () => {
      for (const f of fit) { assert.ok(f.buttonOk && f.labelInside && f.sizeInside, JSON.stringify(f)); assert.equal(f.clipped, false, f.text); assert.ok(f.height >= f.minHeight && f.minHeight >= 56, JSON.stringify(f)); assert.ok(f.noHScroll); }
    });
    await context.close();
  }
  for (const [vp, where] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 320, height: 640 }, 'narrow phone']]) {
    const context = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, userAgent: MOBILE_UA });
    const page = await prepare(context, { ...base_(), videos: [LANDSCAPE] });
    await page.goto(`${base}/`);
    await page.fill('#finder-input', 'https://x.com/handle/status/20');
    await page.click('[data-action=download]');
    await page.waitForSelector('.rcard .dl__size');
    await page.waitForFunction(() => document.querySelector('.rcard .dl__size').textContent);
    await page.evaluate(() => { const l = document.querySelector('.rcard .dl__label'); l.textContent = 'Download HD video · 1080p'; });
    await page.waitForTimeout(900);
    const f = await page.evaluate(() => { const b = document.querySelector('.rcard .dl'); const l = b.querySelector('.dl__label').getBoundingClientRect(); const s = b.querySelector('.dl__size').getBoundingClientRect(); const r = b.getBoundingClientRect(); return { inside: l.left >= r.left && l.right <= r.right && l.bottom <= r.bottom + 0.5 && s.right <= r.right + 0.5, noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1, h: r.height }; });
    await page.screenshot({ path: path.join(OUT, `card-long-text-${where.replace(' ', '-')}.png`) });
    check(`long text +30% (${where}, result card): label wraps inside the button, size stays on the right`, () => { assert.ok(f.inside && f.noHScroll && f.h >= 56, JSON.stringify(f)); });
    await context.close();
  }

  // Focus ring: keyboard only. A mouse click on a button shows no ring.
  {
    const { context, page } = await open({ width: 1440, height: 900 }, 'single');
    await page.click('[data-share]');
    const mouse = await page.evaluate(() => getComputedStyle(document.querySelector('[data-share]')).outlineStyle);
    await page.focus('body');
    await page.keyboard.press('Tab');
    const kb = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`; });
    check('focus ring: none after a mouse click, 2px solid #1747C9 after Tab', () => { assert.equal(mouse, 'none'); assert.equal(kb, 'solid 2px rgb(23, 71, 201)'); });
    await context.close();
  }
};
