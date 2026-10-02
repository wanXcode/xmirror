#!/usr/bin/env node
// Browser acceptance for the result card and the download dialog (DESIGN-SPEC 4.2.1, 5.2.1, focus rules).
// Not part of `npm test` (it needs a browser): run it by hand.
//
//   npm install --no-save playwright-core      # once, unless it is already installed
//   CHROME_PATH=/path/to/chrome node ops/e2e-results.js [outputDir]
//
// It starts its own server on a temporary data folder, stubs /api/resolve and the X image CDN, drives
// Chromium at 1366x768, 1440x900 and 390x844, asserts the layout rules and writes screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const sqlite3 = require('sqlite3');
const { chromium } = require('playwright-core');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'v3'));
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const mk = (url, h, ratio) => ({ url, bitrate: h * 2500, width: Math.round(h * ratio), height: h, resolution: `${Math.round(h * ratio)}x${h}`, content_type: 'video/mp4' });
const video = (name, w, h, ratio) => ({ type: 'video', thumbnail: `https://pbs.twimg.com/amplify_video_thumb/${name}.jpg`, duration: 42, width: w, height: h,
  variants: [1080, 720, 480, 360].map(q => mk(`https://video.twimg.com/${name}/${q}.mp4`, q, ratio)) });
const LANDSCAPE = video('land', 1920, 1080, 16 / 9);
const PORTRAIT = video('port', 720, 1280, 9 / 16);
const GIF = { type: 'gif', thumbnail: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', duration: 6, width: 480, height: 270, variants: [{ url: 'https://video.twimg.com/tweet_video/g.mp4', bitrate: 0, width: 480, height: 270, resolution: '480x270', content_type: 'video/mp4' }] };
const img = n => ({ url: `https://pbs.twimg.com/media/P${n}.jpg`, orig_url: `https://pbs.twimg.com/media/P${n}?format=jpg&name=orig`, width: 1200, height: 800 });
const LONG = 'First lines of the post text, clamped to two lines. This sentence keeps going so that there is far more text than two lines can hold, and the rest must be cut off. ';
const base = { success: true, id: '20', url: 'https://x.com/i/status/20', author: { name: 'Author name', screen_name: 'handle', avatar_url: '' }, sensitive: false, requires_age_confirmation: false, text: LONG.repeat(3), videos: [], gifs: [], images: [], quote: null };
const MB = 1048576;
const SIZES = { 'land/1080.mp4': 11.4 * MB, 'land/720.mp4': 12.6 * MB, 'land/480.mp4': 6.2 * MB, 'land/360.mp4': 3.8 * MB, 'port/1080.mp4': 11.4 * MB, 'port/720.mp4': 8 * MB, 'port/480.mp4': 4 * MB, 'port/360.mp4': 2 * MB, 'tweet_video/g.mp4': 1.2 * MB };

async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-e2e-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, MODERATION_ADMIN_TOKEN: 'e2e-token', ANALYTICS_SRC: '' };
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(log);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const db = new sqlite3.Database(env.SQLITE_PATH);
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, e => (e ? reject(e) : resolve())));
  const post = (id, code, images, withVideo) => run(`INSERT INTO posts(id,url,short_code,author,author_handle,content,images,video,video_status,tweet_time,created_at,html_file) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, `https://x.com/i/status/${id}`, code, 'Author name', 'handle', 'Full post text appears here, including long posts, in a clean reading layout.', JSON.stringify(images), withVideo ? '/videos/v.mp4' : null, withVideo ? 'completed' : 'none', '2026-09-30T10:00:00Z', '2026-10-01 09:00:00', `post_${id}.html`]);
  await post(7001, 'DRW001', [], true);
  await post(7002, 'DRW002', ['https://pbs.twimg.com/media/P1?format=jpg&name=orig', 'https://pbs.twimg.com/media/P2?format=jpg&name=orig'], true);
  await post(7003, 'DRW003', [1, 2, 3, 4].map(n => `https://pbs.twimg.com/media/P${n}?format=jpg&name=orig`), false);
  await new Promise(resolve => db.close(resolve));
  return { base, stop: async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } fs.rmSync(dir, { recursive: true, force: true }); } };
}

async function prepare(context, payload) {
  await context.route(/^https:\/\/(pbs|video)\.twimg\.com\//, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await context.route(/fonts\.(googleapis|gstatic)\.com|a\.zhxs\.me/, route => route.abort());
  const page = await context.newPage();
  await page.route('**/api/resolve', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.route('**/api/media-info', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sizes: Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [`https://video.twimg.com/${k}`, v])) }) }));
  return page;
}

const inView = (box, vp) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5;
const results = [];
const check = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (error) { results.push(['FAIL', name, error.message.split('\n')[0]]); process.exitCode = 1; } };

async function resultCard(browser, base, vp, label, video, tag) {
  const mobile = vp.width < 500;
  const context = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined });
  const page = await prepare(context, { ...base_(), videos: [video] });
  await page.goto(`${base}/`);
  await page.fill('#finder-input', 'https://x.com/handle/status/20');
  await page.click('[data-action=download]');
  await page.waitForSelector('.rcard .dl');
  await page.waitForFunction(() => document.querySelector('.rcard .dl__size')?.textContent);
  await page.waitForTimeout(1200); // smooth scroll settles
  const m = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const q = s => document.querySelector(s);
    const text = q('.rcard__text');
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    return {
      scrollY: window.scrollY, vh: window.innerHeight, dl: rect(q('.rcard .dl')), preview: rect(q('.rcard .preview')), column: rect(q('.rcard .block--video')),
      toggle: rect(q('.rcard .toggle')), info: rect(q('.rcard .block__label')), textHeight: text.getBoundingClientRect().height, lineHeight,
      label: q('.rcard .block__label').textContent, dlText: q('.rcard .dl__label').textContent, size: q('.rcard .dl__size').textContent, sizeWrap: getComputedStyle(q('.rcard .dl__size')).whiteSpace,
      dur: q('.rcard .preview__duration').textContent, durBox: rect(q('.rcard .preview__duration')), inputTop: rect(q('.finder__card')).y,
      minHeight: parseFloat(getComputedStyle(q('.rcard .dl')).minHeight), dlStyleHeight: q('.rcard .dl').style.height || ''
    };
  });
  const name = `${label}-${vp.width}x${vp.height}-${tag}`;
  await page.screenshot({ path: path.join(OUT, `card-${name}.png`) });
  check(`${name}: main download button is fully inside the first screen`, () => assert.ok(inView(m.dl, vp), JSON.stringify(m.dl)));
  check(`${name}: button min-height is 56px and no fixed height`, () => { assert.ok(m.minHeight >= 56); assert.equal(m.dlStyleHeight, ''); assert.ok(m.dl.height >= 56); });
  check(`${name}: info line reads "Video · 1080p · size"`, () => assert.equal(m.label, 'Video · 1080p · 11.4 MB'));
  check(`${name}: button says "Download HD · 1080p" with the size on the right, not wrapping`, () => { assert.equal(m.dlText, 'Download HD · 1080p'); assert.equal(m.size, '11.4 MB'); assert.equal(m.sizeWrap, 'nowrap'); });
  check(`${name}: duration only on the thumbnail's bottom-right corner`, () => { assert.equal(m.dur, '0:42'); assert.ok(m.durBox.x + m.durBox.width <= m.preview.x + m.preview.width + 0.5 && m.durBox.y + m.durBox.height <= m.preview.y + m.preview.height + 0.5); assert.ok(m.durBox.x > m.preview.x + m.preview.width / 2); });
  check(`${name}: post text is clamped to two lines`, () => assert.ok(m.textHeight <= m.lineHeight * 2 + 1, `${m.textHeight} vs ${m.lineHeight}`));
  if (mobile) {
    check(`${name}: preview is at most 50vh tall`, () => assert.ok(m.preview.height <= vp.height * 0.5 + 1, `${m.preview.height}`));
    check(`${name}: the page scrolled so the link box sits at the top (result card in the first screen)`, () => { assert.ok(m.scrollY > 0, `scrollY ${m.scrollY}`); assert.ok(m.inputTop >= 0 && m.inputTop <= 140, `input top ${m.inputTop}`); });
    check(`${name}: "Other qualities" is 4px under the button`, () => assert.ok(Math.abs(m.toggle.y - (m.dl.y + m.dl.height) - 4) <= 1, `${m.toggle.y - (m.dl.y + m.dl.height)}`));
  } else {
    check(`${name}: desktop does not scroll`, () => assert.equal(m.scrollY, 0));
    check(`${name}: thumbnail column is 340px; landscape fills it, portrait is at most 400px tall and centred`, () => {
      assert.ok(m.preview.width <= 340.5);
      if (tag === 'landscape') assert.ok(Math.abs(m.preview.width - 340) <= 1 && Math.abs(m.preview.height - 340 * 9 / 16) <= 2);
      else { assert.ok(m.preview.height <= 400.5); assert.ok(Math.abs((m.preview.x - m.column.x) - (340 - m.preview.width) / 2) <= 1); }
    });
    check(`${name}: info line, button and "Other qualities" are on the right of the thumbnail`, () => { assert.ok(m.dl.x >= m.column.x + 340 - 1); assert.ok(m.info.x >= m.column.x + 340 - 1); assert.ok(Math.abs(m.toggle.y - (m.dl.y + m.dl.height) - 4) <= 1, `${m.toggle.y - (m.dl.y + m.dl.height)}`); });
  }
  await context.close();
}

const base_ = () => JSON.parse(JSON.stringify(base));

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const vp of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await resultCard(browser, server.base, vp, 'home', LANDSCAPE, 'landscape');
      await resultCard(browser, server.base, vp, 'home', PORTRAIT, 'portrait');
    }
    await require('./e2e-dialog')({ browser, base: server.base, OUT, prepare, check, results, assert, inView, payloads: { base_, LANDSCAPE, GIF, img, SIZES } });
  } finally { await browser.close(); await server.stop(); }
  for (const row of results) console.log(row.join(' '));
  console.log(`\n${results.filter(r => r[0] === 'ok').length} passed, ${results.filter(r => r[0] === 'FAIL').length} failed. Screenshots: ${OUT}`);
})().catch(error => { console.error(error); process.exit(1); });
