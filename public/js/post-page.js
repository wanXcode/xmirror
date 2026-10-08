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

    // ---- translate post (X style: the translation replaces the text in place, "Show original" goes back) ----
    var tr = cfg.translation;
    var translateRoot = doc.querySelector('[data-translate]');
    var translation = { taskId: null, shown: false, polls: 0, target: null };
    if (translateRoot && tr) {
      var original = doc.querySelector('[data-post-text]');
      var trToggle = translateRoot.querySelector('[data-translate-toggle]');
      var trStatus = translateRoot.querySelector('[data-translation-status]');
      var trRetry = translateRoot.querySelector('[data-translation-retry]');
      var trBody = doc.querySelector('[data-translation-body]');

      // Browser languages in order of preference -> the first one XPut can translate into; the page language is the fallback.
      var pickTarget = function (languages, fallback) {
        for (var i = 0; i < languages.length; i += 1) {
          var tag = String(languages[i] || '').toLowerCase();
          if (/^zh-(tw|hk|mo|hant)/.test(tag)) return 'zh-TW';
          if (/^zh/.test(tag)) return 'zh-CN';
          if (/^en/.test(tag)) return 'en';
          if (/^(ja|ko|es)(-|$)/.test(tag)) return tag.slice(0, 2);
        }
        return fallback;
      };
      var sameLanguage = function (source, target) {
        return source === target || (source === 'zh' && (target === 'zh-CN' || target === 'zh-TW'));
      };
      var languages = nav.languages && nav.languages.length ? nav.languages : (nav.language ? [nav.language] : []);
      translation.target = pickTarget(languages, tr.fallbackTarget);
      // The link only appears when the reader's language differs from the post's.
      if (!sameLanguage(tr.sourceLang, translation.target)) translateRoot.hidden = false;

      var setStatus = function (message) { trStatus.textContent = message || ''; };
      var languageName = function (code) {
        try { return new win.Intl.DisplayNames([cfg.lang], { type: 'language' }).of(code); } catch (error) { return ''; }
      };
      var showBlocks = function (task) {
        var nodes = (task.blocks || []).map(function (block) {
          var tag = block.type === 'h2' || block.type === 'h3' ? block.type : 'p';
          var el = doc.createElement(tag);
          el.textContent = block.text;
          if (!block.translated) el.className = 'is-pending';
          return el;
        });
        trBody.replaceChildren.apply(trBody, nodes);
        trBody.setAttribute('lang', translation.target === 'zh-CN' ? 'zh-Hans' : translation.target === 'zh-TW' ? 'zh-Hant' : translation.target);
      };
      var attribution = function (task) {
        var from = task.sourceLang && task.sourceLang !== 'auto' ? task.sourceLang : tr.sourceLang;
        var name = from ? languageName(from) : '';
        return (name ? Link.fillTemplate(tr.text.translateFrom, { lang: name }) : tr.text.translateBy) + ' · ' + tr.text.translateDisclaimer;
      };
      var describe = function (task) {
        var failed = task.failed || 0;
        trRetry.hidden = !(task.status === 'partial_failed' || (task.status === 'failed' && failed));
        if (task.status === 'completed') return attribution(task);
        if (task.status === 'partial_failed') return Link.fillTemplate(tr.text.translatePartial, { failed: failed });
        if (task.status === 'failed') return tr.text.translateFailed;
        if (task.status === 'queued' && !task.completed) return tr.text.translateQueued;
        return Link.fillTemplate(tr.text.translateProgress, { done: task.completed || 0, total: task.total || 0 });
      };
      var failWith = function (message) {
        setStatus(message);
        trRetry.hidden = false;
        if (!translation.taskId) setShown(false);
      };
      // Showing the translation hides the original text; going back restores it. Nothing is requested twice.
      var setShown = function (shown) {
        translation.shown = shown;
        trBody.hidden = !shown || !translation.taskId;
        original.hidden = shown && !!translation.taskId;
        trToggle.disabled = false;
        trToggle.textContent = shown ? tr.text.translateShowOriginal : (translation.taskId ? tr.text.translateShowTranslation : tr.text.translate);
        trToggle.setAttribute('aria-pressed', shown ? 'true' : 'false');
      };
      var TERMINAL = { completed: 1, partial_failed: 1, failed: 1 };
      var apply = function (task) {
        translation.taskId = task.id;
        showBlocks(task);
        setShown(translation.shown);
        setStatus(describe(task));
        if (TERMINAL[task.status] || translation.polls >= POLL_LIMIT) return;
        translation.polls += 1;
        timers.setTimeout(refresh, 1500);
      };
      var readJson = function (response) {
        return response.json().catch(function () { return null; }).then(function (data) { return { response: response, data: data }; });
      };
      var onReply = function (result) {
        if (result.response.status === 429) { failWith(tr.text.translateBusy); return; }
        if (!result.response.ok || !result.data || !result.data.success) { failWith((result.data && result.data.error) || tr.text.translateFailed); return; }
        apply(result.data.task);
      };
      var refresh = function () {
        // A dropped poll is not a failed translation: keep trying until the limit.
        fetchFn(tr.endpoints.task + translation.taskId, { credentials: 'same-origin' }).then(readJson).then(onReply).catch(function () {
          if (translation.polls < POLL_LIMIT) { translation.polls += 1; timers.setTimeout(refresh, 3000); }
        });
      };
      var start = function () {
        translation.shown = true;
        trToggle.disabled = true;
        trToggle.textContent = tr.text.translateStarting;
        setStatus('');
        trRetry.hidden = true;
        return postJson(tr.endpoints.create, { targetLang: translation.target }).then(readJson).then(onReply).catch(function () { failWith(tr.text.translateFailed); });
      };
      trToggle.addEventListener('click', function () {
        if (!translation.taskId) return start();
        setShown(!translation.shown);
        return Promise.resolve();
      });
      trRetry.addEventListener('click', function () {
        trRetry.hidden = true;
        if (!translation.taskId) { start(); return; }
        translation.polls = 0;
        postJson(tr.endpoints.task + translation.taskId + '/retry', {}).then(readJson).then(onReply).catch(function () { failWith(tr.text.translateFailed); });
      });
    }

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
