// Saved-post page behaviour: copy/share link, the download drawer, full-screen photos,
// the age check and waiting for a video that is still being saved.
(function (root) {
  var Download = typeof require === 'function' ? require('./download') : root.XPutDownload;
  var Result = typeof require === 'function' ? require('./result-card') : root.XPutResultCard;
  var Link = typeof require === 'function' ? require('./link') : root.XPutLink;

  var TOAST_MS = 2500;
  var POLL_MS = 4000;
  var POLL_LIMIT = 300; // ~20 minutes

  function initPostPage(options) {
    var doc = options.doc;
    var win = options.win;
    var configEl = doc.querySelector('[data-post-config]');
    if (!configEl) return null;
    var cfg = JSON.parse(configEl.textContent);
    var fetchFn = options.fetch || (win.fetch && win.fetch.bind(win));
    var timers = options.timers || { setTimeout: win.setTimeout.bind(win), setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win) };
    var nav = options.nav || win.navigator || {};
    var reload = options.reload || function () { win.location.reload(); };
    var isPhone = options.isPhone || function () { return !!(win.matchMedia && win.matchMedia('(max-width: 767px)').matches); };

    function postJson(url, body) {
      return fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body || {}), keepalive: true });
    }

    var renderer = Result.createResultRenderer(Object.assign({
      doc: doc, win: win, text: cfg.result, lang: cfg.lang, platform: Download.detectPlatform(nav), nav: nav, fetch: fetchFn,
      downloadBase: cfg.downloadBase, shortcutHref: cfg.shortcutHref, timers: timers,
      fetchSizes: function (urls) {
        return postJson(cfg.endpoints.mediaInfo, { urls: urls }).then(function (r) { return r.ok ? r.json() : { sizes: {} }; }).then(function (d) { return d.sizes || {}; });
      },
      onViewSave: function () {}
    }, options.result || {}));

    // ---- copy / share link ----
    var shareButton = doc.querySelector('[data-share]');
    var toast = doc.querySelector('[data-toast]');
    var toastTimer = null;
    function copied() {
      if (!shareButton) return;
      var original = shareButton.innerHTML;
      shareButton.classList.add('is-copied');
      shareButton.textContent = cfg.text.linkCopied;
      if (toast) toast.hidden = false;
      toastTimer = timers.setTimeout(function () {
        shareButton.classList.remove('is-copied');
        shareButton.innerHTML = original;
        if (toast) toast.hidden = true;
        toastTimer = null;
      }, TOAST_MS);
    }
    function countShare() {
      try { postJson(cfg.endpoints.share, {}).catch(function () {}); } catch (error) { /* counting is best effort */ }
    }
    function share() {
      if (isPhone() && typeof nav.share === 'function') {
        return nav.share({ title: cfg.title, url: cfg.shareUrl }).then(countShare, function () { /* cancelled */ });
      }
      var write = nav.clipboard && nav.clipboard.writeText ? nav.clipboard.writeText(cfg.shareUrl) : Promise.reject(new Error('no clipboard'));
      return write.then(function () { copied(); countShare(); }, function () {
        // Without clipboard access the link is already in the address bar; just say so.
        copied();
      });
    }
    if (shareButton) shareButton.addEventListener('click', share);

    // ---- download drawer ----
    var sheet = doc.querySelector('[data-sheet]');
    var overlay = doc.querySelector('[data-sheet-overlay]');
    var body = doc.querySelector('[data-sheet-body]');
    var opener = doc.querySelector('[data-open-drawer]');
    var loaded = false;

    function mediaCount(data) { return (data.videos || []).length + (data.gifs || []).length + (data.images || []).length; }
    // "· 4 items" when the post mixes media types or has several videos/GIFs; a lone video or a photo set needs no count.
    function showCount(data) {
      var el = sheet && sheet.querySelector('[data-sheet-count]');
      if (!el) return;
      var videos = (data.videos || []).length + (data.gifs || []).length;
      var kinds = (data.videos || []).length > 0 ? 1 : 0;
      kinds += (data.gifs || []).length > 0 ? 1 : 0;
      kinds += (data.images || []).length > 0 ? 1 : 0;
      el.textContent = kinds > 1 || videos > 1 ? ' ' + Link.fillTemplate(cfg.text.drawerItems, { n: mediaCount(data) }) : '';
    }
    function focusFirstDownload() {
      var first = body.querySelector('.dl:not(:disabled), .variant, .photo__check');
      var target = body.querySelector('.dl:not(:disabled)') || first;
      if (target && target.focus) target.focus();
      return !!target;
    }
    // Focus moves to the first download button once the list is on screen, unless the visitor already moved it.
    function settleFocus() {
      var active = doc.activeElement;
      if (!active || active === sheet || active === doc.body) focusFirstDownload();
    }
    function showLocal(withNote) {
      var nodes = [];
      if (withNote) { var note = doc.createElement('p'); note.className = 'note'; note.textContent = cfg.text.drawerLocalNote; nodes.push(note); }
      var local = Object.assign({ id: cfg.code }, cfg.local);
      showCount(local);
      nodes.push(renderer.renderBlocks(local));
      body.replaceChildren.apply(body, nodes);
    }
    function loadDrawer() {
      if (loaded) return Promise.resolve();
      loaded = true;
      body.textContent = cfg.text.drawerLoading;
      return postJson(cfg.endpoints.resolve, { url: cfg.url }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (response.ok && data && data.success && !data.requires_age_confirmation && mediaCount(data)) { showCount(data); body.replaceChildren(renderer.renderBlocks(data)); }
          else showLocal(true);
        });
      }).catch(function () { showLocal(true); }).then(settleFocus);
    }
    var closeButton = doc.querySelector('[data-sheet-close]');
    function openSheet() {
      if (!sheet) return;
      sheet.hidden = false; overlay.hidden = false;
      doc.documentElement.classList.add('has-overlay');
      // Until the list is there, focus sits on the dialog itself so it is already inside the focus trap.
      if (sheet.focus) sheet.focus();
      loadDrawer();
      if (loaded) settleFocus();
    }
    function closeSheet() {
      if (!sheet || sheet.hidden) return;
      sheet.hidden = true; overlay.hidden = true;
      doc.documentElement.classList.remove('has-overlay');
      if (opener && opener.focus) opener.focus();
    }
    // Tab and Shift+Tab stay inside the dialog.
    function focusable() {
      return [].slice.call(sheet.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')).filter(function (el) {
        return !el.disabled && !el.closest('[hidden]');
      });
    }
    function trapTab(event) {
      var items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var active = doc.activeElement;
      var outside = !sheet.contains(active) || active === sheet;
      if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
    }
    if (opener) opener.addEventListener('click', openSheet);
    if (overlay) overlay.addEventListener('click', closeSheet);
    if (closeButton) closeButton.addEventListener('click', closeSheet);
    doc.addEventListener('keydown', function (event) {
      if (!sheet || sheet.hidden) return;
      if (event.key === 'Escape') closeSheet();
      else if (event.key === 'Tab') trapTab(event);
    });

    // ---- gallery -> full screen ----
    doc.querySelectorAll('[data-lightbox]').forEach(function (node) {
      node.addEventListener('click', function () { renderer.openLightbox({ id: cfg.code }, cfg.photos, Number(node.getAttribute('data-lightbox'))); });
    });

    // ---- age check ----
    var ageButton = doc.querySelector('[data-age-confirm]');
    if (ageButton) ageButton.addEventListener('click', function () {
      postJson(cfg.endpoints.ageConfirm, {}).then(function (response) { if (response.ok) reload(); }).catch(function () {});
    });

    // ---- a video that is still being saved ----
    var polls = 0;
    var pollTimer = null;
    function poll() {
      polls += 1;
      if (polls > POLL_LIMIT) { timers.clearInterval(pollTimer); return; }
      fetchFn(cfg.endpoints.videoStatus, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && (data.status === 'completed' || data.status === 'failed')) { timers.clearInterval(pollTimer); reload(); }
      }).catch(function () { /* try again on the next tick */ });
    }
    if (cfg.videoPending) pollTimer = timers.setInterval(poll, POLL_MS);

    return { share: share, openSheet: openSheet, closeSheet: closeSheet, loadDrawer: loadDrawer, poll: poll };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { initPostPage: initPostPage };
  else if (root.document) initPostPage({ doc: root.document, win: root });
})(typeof window !== 'undefined' ? window : globalThis);
