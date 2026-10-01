const { raw } = require('../html');

const svg = (body, size = 20, extra = '') =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`);

module.exports = {
  globe: (size = 16) => svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', size),
  chevronDown: (size = 14) => svg('<path d="M6 9l6 6 6-6"/>', size, ' stroke-width="2"'),
  menu: (size = 20) => svg('<path d="M4 7h16M4 12h16M4 17h16"/>', size, ' stroke-width="2"'),
  close: (size = 20) => svg('<path d="M6 6l12 12M18 6L6 18"/>', size, ' stroke-width="2"'),
  check: (size = 18) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', size, ' stroke-width="2.2"'),
  download: (size = 20) => svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', size),
  eye: (size = 20) => svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', size),
  phone: (size = 20) => svg('<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>', size)
};
