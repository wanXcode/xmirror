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
  link: (size = 22) => svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', size, ' stroke-width="2"'),
  clipboard: (size = 22) => svg('<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4h6v3H9z"/>', size, ' stroke-width="2"'),
  layers: (size = 20) => svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', size, ' stroke-width="2"'),
  image: (size = 20) => svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>', size, ' stroke-width="2"'),
  shield: (size = 20) => svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', size, ' stroke-width="2"'),
  clock: (size = 20) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', size, ' stroke-width="2"'),
  share: (size = 20) => svg('<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>', size, ' stroke-width="2"'),
  info: (size = 20) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>', size, ' stroke-width="2"'),
  external: (size = 16) => svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', size, ' stroke-width="2"'),
  eyeOff: (size = 30) => svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.6 3.8M6.2 6.2A13 13 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.8-1.3"/>', size),
  phone: (size = 20) => svg('<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>', size)
};
