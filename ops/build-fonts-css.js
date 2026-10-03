#!/usr/bin/env node
// Builds public/css/fonts.css (Latin faces, inlined into every page) from the @fontsource packages.
// Fonts are served by lib/routes/fonts.js, so pages make no third-party font requests.
// Chinese text uses the visitor's system CJK font: Noto Sans SC as a web font is ~700 KB of
// unicode-range slices for a typical page and pushed mobile LCP past 6 s.
//
//   node ops/build-fonts-css.js      (rerun after changing the font list or upgrading a package)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'css');

const LATIN = [
  ['ibm-plex-sans', [400, 500, 600]],
  ['space-grotesk', [500, 700]]
];

function faces(pkg, weight, keep) {
  const css = fs.readFileSync(path.join(ROOT, 'node_modules', '@fontsource', pkg, `${weight}.css`), 'utf8');
  const out = [];
  for (const block of css.split('@font-face').slice(1)) {
    const slice = /\/\* (.+?) \*\//.exec(css.slice(css.indexOf(block) - 80, css.indexOf(block)))?.[1] || '';
    const file = /url\(\.\/files\/([^)]+?\.woff2)\)/.exec(block)?.[1];
    const family = /font-family: '([^']+)'/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    if (!file || !family || !range || !keep(file)) continue;
    out.push(`@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weight};src:url(/fonts/${pkg}/${file}) format('woff2');unicode-range:${range.trim()}}`);
  }
  return out;
}

const latinOnly = file => /-latin-\d+-normal\.woff2$/.test(file);

const latin = LATIN.flatMap(([pkg, weights]) => weights.flatMap(weight => faces(pkg, weight, latinOnly)));
fs.writeFileSync(path.join(OUT, 'fonts.css'), `${latin.join('\n')}\n`);
console.log(`fonts.css: ${latin.length} faces`);
