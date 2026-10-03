const QRCode = require('qrcode');

// A QR code as an inline SVG: one square per dark module, drawn as a single path.
// Generated on the server so the page needs no script and no image request.
const cache = new Map();

function qrSvg(text, { margin = 2, label = '', size = 160 } = {}) {
  const key = `${text}|${margin}|${label}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const parts = [];
  for (let y = 0; y < count; y += 1) {
    let x = 0;
    while (x < count) {
      if (!qr.modules.get(x, y)) { x += 1; continue; }
      let run = 1;
      while (x + run < count && qr.modules.get(x + run, y)) run += 1;
      parts.push(`M${x + margin} ${y + margin}h${run}v1h-${run}z`);
      x += run;
    }
  }
  const total = count + margin * 2;
  const aria = label ? `role="img" aria-label="${label.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}"` : 'aria-hidden="true"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="qr" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" ${aria}><rect width="${total}" height="${total}" fill="#fff"/><path d="${parts.join('')}" fill="#1F1A14"/></svg>`;
  cache.set(key, svg);
  return svg;
}

module.exports = { qrSvg };
