const fs = require('node:fs');
const path = require('node:path');

// Self-hosted web fonts, served from the @fontsource packages (see ops/build-fonts-css.js).
// Only the listed packages and .woff2 files are reachable; the files never change for a given
// package version, so they are cached for a year.
const PACKAGES = new Set(['ibm-plex-sans', 'space-grotesk']);
const FILE = /^[a-z0-9-]+\.woff2$/;

function registerFontRoutes(app, { root = path.join(__dirname, '..', '..', 'node_modules', '@fontsource') } = {}) {
  app.get('/fonts/:pkg/:file', (req, res) => {
    const { pkg, file } = req.params;
    if (!PACKAGES.has(pkg) || !FILE.test(file)) return res.sendStatus(404);
    const full = path.join(root, pkg, 'files', file);
    if (!fs.existsSync(full)) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*' });
    return res.sendFile(full, { headers: {}, cacheControl: false });
  });
}

module.exports = { registerFontRoutes };
