const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

// Version string for /css and /js URLs: the package version plus a hash of the asset files, so a
// deploy that changes any of them gets new URLs and the files can be cached for a year.
function assetVersion(publicDir = path.join(__dirname, '..', 'public')) {
  const hash = crypto.createHash('sha1');
  for (const dir of ['css', 'js']) {
    const folder = path.join(publicDir, dir);
    let names = [];
    try { names = fs.readdirSync(folder).filter(name => /\.(css|js)$/.test(name)).sort(); } catch { /* no assets */ }
    for (const name of names) hash.update(`${dir}/${name}:`).update(fs.readFileSync(path.join(folder, name)));
  }
  return `${version}-${hash.digest('hex').slice(0, 8)}`;
}

module.exports = { assetVersion };
