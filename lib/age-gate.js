const { parseCookies } = require('./i18n');

const AGE_COOKIE = 'xput_age';

// "I am 18 or older" is remembered for the browser session only (no Max-Age),
// and the server, not the page, decides whether media links are released.
function hasAgeConfirmation(req) {
  return parseCookies(req.headers?.cookie)[AGE_COOKIE] === '1';
}

function setAgeConfirmation(res, { secure = false } = {}) {
  res.cookie(AGE_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

module.exports = { AGE_COOKIE, hasAgeConfirmation, setAgeConfirmation };
