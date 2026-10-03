// Extra gates for the *automatic* part of the indexing rule (manual 'index' overrides are exempt
// from the daily cap). Defaults live in config/seo-auto-index.json; environment overrides:
//   SEO_AUTO_INDEX_DAILY_CAP        max automatic new inclusions per UTC day (integer >= 0)
//   SEO_AUTO_INDEX_BLOCK_SENSITIVE  'false' lets posts flagged possibly_sensitive qualify (not recommended)
const defaults = require('../config/seo-auto-index.json');

function load(env = process.env) {
  const raw = env.SEO_AUTO_INDEX_DAILY_CAP;
  const cap = raw !== undefined && raw !== '' && /^\d+$/.test(String(raw).trim()) ? Number(raw)
    : (Number.isInteger(defaults.dailyCap) && defaults.dailyCap >= 0 ? defaults.dailyCap : 20);
  const blockSensitive = env.SEO_AUTO_INDEX_BLOCK_SENSITIVE !== undefined && env.SEO_AUTO_INDEX_BLOCK_SENSITIVE !== ''
    ? env.SEO_AUTO_INDEX_BLOCK_SENSITIVE !== 'false' : defaults.blockSensitive !== false;
  return { dailyCap: cap, blockSensitive };
}
const dayStart = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const nextDayStart = (date = new Date()) => new Date(dayStart(date).getTime() + 86400000);
module.exports = { load, dayStart, nextDayStart };
