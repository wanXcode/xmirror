const fs = require('node:fs');
const path = require('node:path');

const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

function loadReservedShortCodes(file = path.join(__dirname, '..', 'config', 'reserved-shortcodes.json')) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list) || list.some(item => typeof item !== 'string')) throw new Error('reserved-shortcodes.json must be an array of strings');
  return new Set(list.map(item => item.toLowerCase()));
}

// Routing is case-insensitive for fixed pages, so "Report" must be reserved too.
function isReservedShortCode(code, reserved) {
  return reserved.has(String(code).toLowerCase());
}

module.exports = { SHORT_CODE_PATTERN, isReservedShortCode, loadReservedShortCodes };
