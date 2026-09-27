// Only fixed event names and page categories; never send post text, submitted URLs or contact details.
window.xputTrack = function(name) {
  if (!['Archive completed','Archive read','Archive start','Browse archives','Translation requested'].includes(name)) return;
  const plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments); };
  window.plausible = plausible;
  plausible(name);
};
document.addEventListener('click', event => {
  const href = event.target.closest('a')?.getAttribute('href');
  if (href === '/browse') window.xputTrack('Browse archives');
});
if (/^\/[A-Za-z0-9]{6}$/.test(location.pathname)) window.xputTrack('Archive read');
