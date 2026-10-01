// Dates on saved-post pages: "Oct 1, 2026" / "2026年10月1日". SQLite stores UTC without a zone,
// so a bare "YYYY-MM-DD HH:MM:SS" is read as UTC.
function toDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'pt-BR' ? 'pt-BR' : 'en-US';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: lang === 'zh' ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function toIsoDate(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

module.exports = { formatDate, toDate, toIsoDate };
