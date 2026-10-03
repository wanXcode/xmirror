// Progressive enhancement for the header: language dropdown / bottom sheet and
// the mobile menu drawer. All links work without this script; it only toggles
// visibility, aria state and focus.
(function (root) {
  function init(doc, win) {
    var langToggle = doc.querySelector('[data-lang-toggle]');
    var langPanel = doc.querySelector('[data-lang-panel]');
    var menuToggle = doc.querySelector('[data-menu-toggle]');
    var drawer = doc.querySelector('[data-drawer]');
    var overlay = doc.querySelector('[data-overlay]');
    if (!langToggle || !langPanel || !menuToggle || !drawer || !overlay) return null;

    var isPhone = function () { return !win.matchMedia || win.matchMedia('(max-width: 767px)').matches; };
    var root_ = doc.documentElement;

    function sync() {
      var langOpen = !langPanel.hidden;
      var menuOpen = !drawer.hidden;
      // The dim overlay is for phone surfaces only; the desktop dropdown has none.
      overlay.hidden = !((langOpen && isPhone()) || menuOpen);
      root_.classList.toggle('has-overlay', !overlay.hidden);
      langToggle.setAttribute('aria-expanded', String(langOpen));
      menuToggle.setAttribute('aria-expanded', String(menuOpen));
    }

    function closeLang(restoreFocus) {
      if (langPanel.hidden) return;
      langPanel.hidden = true;
      sync();
      if (restoreFocus) langToggle.focus();
    }

    function closeMenu(restoreFocus) {
      if (drawer.hidden) return;
      drawer.hidden = true;
      sync();
      if (restoreFocus) menuToggle.focus();
    }

    langToggle.addEventListener('click', function () {
      if (langPanel.hidden) {
        closeMenu(false);
        langPanel.hidden = false;
        sync();
        var first = langPanel.querySelector('a');
        if (first && isPhone()) first.focus();
      } else {
        closeLang(true);
      }
    });

    menuToggle.addEventListener('click', function () {
      if (drawer.hidden) {
        closeLang(false);
        drawer.hidden = false;
        sync();
        var close = drawer.querySelector('[data-menu-close]');
        if (close) close.focus();
      } else {
        closeMenu(true);
      }
    });

    var closeButton = drawer.querySelector('[data-menu-close]');
    if (closeButton) closeButton.addEventListener('click', function () { closeMenu(true); });

    overlay.addEventListener('click', function () { closeLang(false); closeMenu(false); });

    doc.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!langPanel.hidden) closeLang(true);
      else if (!drawer.hidden) closeMenu(true);
    });

    // Desktop dropdown closes when focus or a click lands outside it.
    doc.addEventListener('click', function (event) {
      if (!langPanel.hidden && !isPhone() && !langPanel.contains(event.target) && !langToggle.contains(event.target)) closeLang(false);
    });

    // Resizing past the breakpoint must not leave a hidden-but-dimmed page.
    if (win.matchMedia) {
      var query = win.matchMedia('(max-width: 767px)');
      var onChange = function () { if (!isPhone()) closeMenu(false); sync(); };
      if (query.addEventListener) query.addEventListener('change', onChange);
    }

    return { closeLang: closeLang, closeMenu: closeMenu };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { init: init };
  else if (root.document) init(root.document, root);
})(typeof window !== 'undefined' ? window : globalThis);
