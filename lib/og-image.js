const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 1200x630 share previews, drawn per W_OG: text-only and "post with media" layouts.
// satori and resvg are loaded on first use so they cost nothing on startup.

const WIDTH = 1200;
const HEIGHT = 630;
const INK = '#1F1A14';
const MUTED = '#554B40';
const SOFT = '#7A6E60';
const PAPER = '#FBF7F0';
const BLUE = '#1747C9';
const ORANGE = '#FF8A4C';

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️⃣\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;

const fontRoot = name => path.join(path.dirname(require.resolve(`@fontsource/${name}/package.json`)), 'files');
let fontsPromise = null;

function loadFonts() {
  fontsPromise ||= Promise.resolve().then(() => {
    const read = (pkg, file) => fs.readFileSync(path.join(fontRoot(pkg), file));
    return [
      { name: 'IBM Plex Sans', data: read('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'IBM Plex Sans', data: read('ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'IBM Plex Sans', data: read('ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff'), weight: 600, style: 'normal' },
      { name: 'Space Grotesk', data: read('space-grotesk', 'space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' }
    ];
  });
  return fontsPromise;
}

// Noto Sans SC ships as ~100 unicode-range slices (see its <weight>.css). Only the slices that hold
// the glyphs a given image needs are read, and each is kept in memory once loaded.
// satori only falls back across differently named fonts, so each slice gets its own name; one weight is enough.
const CJK_WEIGHTS = [500];
const sliceCache = new Map();
let sliceIndex = null;

function loadSliceIndex() {
  sliceIndex ||= CJK_WEIGHTS.map(weight => {
    const css = fs.readFileSync(path.join(fontRoot('noto-sans-sc'), '..', `${weight}.css`), 'utf8');
    const slices = [];
    for (const block of css.split('@font-face').slice(1)) {
      const file = /files\/(noto-sans-sc-[^.)]+?\.woff)\)/.exec(block)?.[1] || /url\(\.\/files\/(noto-sans-sc-[^)]+?\.woff)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (!file || !range) continue;
      const ranges = range.split(',').map(part => part.trim().replace(/^U\+/i, '').split('-').map(hex => parseInt(hex, 16)));
      slices.push({ file, ranges: ranges.map(([from, to = from]) => [from, to]) });
    }
    return { weight, slices };
  });
  return sliceIndex;
}

function loadCjkFonts(text) {
  const points = [...new Set([...String(text)].map(char => char.codePointAt(0)).filter(code => code > 0x2ff))];
  const fonts = [];
  for (const { weight, slices } of loadSliceIndex()) {
    for (const slice of slices) {
      if (!points.some(code => slice.ranges.some(([from, to]) => code >= from && code <= to))) continue;
      if (!sliceCache.has(slice.file)) sliceCache.set(slice.file, fs.readFileSync(path.join(fontRoot('noto-sans-sc'), slice.file)));
      fonts.push({ name: `NSC-${slice.file}`, data: sliceCache.get(slice.file), weight, style: 'normal' });
    }
  }
  return fonts;
}

function cleanText(value) {
  return String(value || '').replace(EMOJI, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

// First ~120 characters, cut at a word boundary (or anywhere for CJK, which has no spaces).
function clip(text, limit = 120) {
  const chars = [...cleanText(text)];
  if (chars.length <= limit) return chars.join('');
  const head = chars.slice(0, limit).join('');
  const space = head.lastIndexOf(' ');
  const cut = space > limit * 0.5 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,.;:!?，。；：！？、-]+$/, '')}…`;
}

const el = (type, style, children, props = {}) => ({ type, props: { style: { display: 'flex', ...style }, children, ...props } });

function imageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

function dataUri(buffer) {
  const type = imageType(buffer);
  return type ? `data:${type};base64,${buffer.toString('base64')}` : null;
}

function logo() {
  const mark = el('div', { width: 48, height: 48, borderRadius: 10, background: BLUE, position: 'relative', alignItems: 'center', justifyContent: 'center' }, [
    { type: 'svg', props: { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', children: { type: 'path', props: { d: 'M6 5l12 12M18 5L6 17', stroke: '#FFFFFF', strokeWidth: 2.6, strokeLinecap: 'round' } } } },
    el('div', { position: 'absolute', right: -3, bottom: -3, width: 12, height: 12, borderRadius: 6, background: ORANGE, border: `2px solid ${PAPER}` }, '')
  ]);
  return el('div', { alignItems: 'center', gap: 8 }, [mark, el('div', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 34, color: INK }, 'XPut')]);
}

function mediaTile(thumb) {
  const play = el('div', { width: 96, height: 96, borderRadius: 48, background: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }, {
    type: 'svg', props: { width: 40, height: 40, viewBox: '0 0 24 24', children: { type: 'path', props: { d: 'M8 5v14l11-7z', fill: INK } } }
  });
  const style = { width: 380, height: 380, flexShrink: 0, borderRadius: 28, background: '#2E2822', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' };
  if (!thumb || !thumb.src) return el('div', style, thumb && thumb.video ? play : '');
  return el('div', style, [
    { type: 'img', props: { src: thumb.src, width: 380, height: 380, style: { position: 'absolute', left: 0, top: 0, width: 380, height: 380, objectFit: 'cover' } } },
    ...(thumb.video ? [play] : [])
  ]);
}

function buildTree({ author, handle, text, avatar, media, thumb, lang, cjkFamilies = [] }) {
  const body = clip(text);
  const withMedia = Boolean(media);
  const avatarNode = avatar
    ? { type: 'img', props: { src: avatar, width: 72, height: 72, style: { width: 72, height: 72, borderRadius: 36 } } }
    : el('div', { width: 72, height: 72, borderRadius: 36, background: '#E8DCCB' }, '');
  const family = ['IBM Plex Sans', ...cjkFamilies].map(name => `"${name}"`).join(', ');
  const identity = el('div', { alignItems: 'center', gap: 16 }, [
    avatarNode,
    el('div', { flexDirection: 'column' }, [
      el('div', { fontSize: 34, fontWeight: 600, color: INK }, clip(author, 40) || 'X'),
      el('div', { fontSize: 26, color: SOFT }, handle ? `@${cleanText(handle).slice(0, 30)} on X` : 'on X')
    ])
  ]);
  const column = el('div', { flexDirection: 'column', gap: 22, flexGrow: 1, minWidth: 0, flexShrink: 1 }, [
    identity,
    el('div', { fontSize: withMedia ? 36 : 44, lineHeight: 1.3, fontWeight: 500, color: INK, wordBreak: 'break-word' }, body)
  ]);
  return el('div', { width: WIDTH, height: HEIGHT, background: PAPER, padding: '64px 72px', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden', fontFamily: family, color: INK }, [
    el('div', { position: 'absolute', right: -80, bottom: -80, width: 260, height: 260, borderRadius: 130, background: ORANGE, opacity: 0.9 }, ''),
    el('div', { gap: 48, alignItems: 'center', flexGrow: 1 }, withMedia ? [column, mediaTile(thumb)] : [column]),
    el('div', { justifyContent: 'space-between', alignItems: 'center', position: 'relative' }, [
      logo(),
      el('div', { fontSize: 24, color: MUTED }, lang === 'zh' ? 'xput.app · 已保存的副本' : 'xput.app · Saved copy')
    ])
  ]);
}

async function renderOgImage(input) {
  const [{ default: satori }, { Resvg }] = await Promise.all([import('satori'), Promise.resolve(require('@resvg/resvg-js'))]);
  const needsCjk = [input.author, input.text, input.handle].some(value => CJK.test(String(value || '')));
  const cjk = needsCjk ? loadCjkFonts(`${input.author} ${input.handle} ${clip(input.text)} 已保存的副本`) : [];
  const fonts = [...(await loadFonts()), ...cjk];
  const lang = needsCjk ? 'zh' : 'en';
  const svg = await satori(buildTree({ ...input, lang: input.lang || lang, cjkFamilies: cjk.map(font => font.name) }), { width: WIDTH, height: HEIGHT, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}

// Cache key covers everything drawn, so an edited post gets a new file.
function cacheKey(code, input) {
  const hash = crypto.createHash('sha1').update(JSON.stringify([input.author, input.handle, clip(input.text), Boolean(input.media), input.avatarUrl || '', input.thumbPath || ''])).digest('hex').slice(0, 12);
  return `${code}-${hash}.png`;
}

module.exports = { HEIGHT, WIDTH, buildTree, cacheKey, clip, cleanText, dataUri, imageType, renderOgImage };
