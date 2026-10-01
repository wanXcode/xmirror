// Link box behaviour: paste, clipboard hint, validation and the states from the
// design (loading, errors, sensitive confirmation, saving). All user-visible text
// comes from the JSON config rendered by the server, so it follows the page language.
(function (root) {
  var Link = typeof require === 'function' ? require('./link') : root.XPutLink;

  var ICONS = {
    clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    hourglass: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8"/></svg>',
    cross: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    eyeOff: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.6 3.8M6.2 6.2A13 13 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.8-1.3"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>'
  };

  var MIN_SAVING_MS = 1200;

  function createFinder(options) {
    var rootEl = options.root;
    var doc = options.doc || rootEl.ownerDocument;
    var win = options.win || root;
    var fetchFn = options.fetch || (win.fetch && win.fetch.bind(win));
    var navigate = options.navigate || function (url) { win.location.assign(url); };
    var timers = options.timers || { setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win), setTimeout: win.setTimeout.bind(win) };
    var clipboard = options.clipboard !== undefined ? options.clipboard : (win.navigator && win.navigator.clipboard);
    var permissions = options.permissions !== undefined ? options.permissions : (win.navigator && win.navigator.permissions);

    var configEl = rootEl.querySelector('[data-finder-config]');
    if (!configEl) return null;
    var config = JSON.parse(configEl.textContent);
    var text = config.input;
    var endpoints = config.endpoints;
    var mode = config.mode;

    var form = rootEl.querySelector('form');
    var input = rootEl.querySelector('[data-input]');
    var panel = rootEl.querySelector('[data-panel]');
    var message = rootEl.querySelector('[data-message]');
    var clipboardHint = rootEl.querySelector('[data-clipboard]');
    var field = rootEl.querySelector('.finder__field');
    var downloadButton = rootEl.querySelector('[data-action="download"]');
    var viewButton = rootEl.querySelector('[data-action="view"]');
    var pasteButton = rootEl.querySelector('[data-action="paste"]');
    var idleHtml = panel.innerHTML;
    var clipboardCandidate = null;
    var countdownTimer = null;
    var current = { action: null };

    var labels = new Map();
    [downloadButton, viewButton].forEach(function (button) {
      if (button) labels.set(button, button.querySelector('.btn__label').textContent);
    });

    // ---- small DOM helpers (text only goes in via textContent) ----
    function el(tag, className, content) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    }
    function icon(name, className) {
      var span = el('span', className);
      span.innerHTML = ICONS[name]; // constant markup above, never user text
      return span;
    }
    function button(label, className, onClick) {
      var node = el('button', className, label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    }

    function setState(name) { rootEl.setAttribute('data-state', name); }

    function stopCountdown() {
      if (countdownTimer) { timers.clearInterval(countdownTimer); countdownTimer = null; }
    }

    function showMessage(content, tone) {
      message.textContent = '';
      if (!content) { message.hidden = true; return; }
      message.className = 'finder__message' + (tone === 'info' ? ' finder__message--info' : '');
      if (tone !== 'info') message.appendChild(icon('alert'));
      message.appendChild(el('span', '', content));
      message.hidden = false;
    }

    function markInvalid(on) {
      field.classList.toggle('is-invalid', on);
      if (on) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'finder-message'); }
      else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    }

    function setBusy(which) {
      [['download', downloadButton], ['view', viewButton]].forEach(function (pair) {
        var button = pair[1];
        if (!button) return;
        var label = button.querySelector('.btn__label');
        var busy = which === pair[0];
        button.classList.toggle('is-loading', busy);
        button.classList.toggle('is-disabled', !!which && !busy);
        button.disabled = !!which;
        button.setAttribute('aria-busy', String(busy));
        label.textContent = busy ? (pair[0] === 'download' ? text.fetching : text.saving) : labels.get(button);
      });
    }

    function clearFeedback() {
      stopCountdown();
      showMessage('');
      markInvalid(false);
    }

    function showIdle() {
      clearFeedback();
      panel.innerHTML = idleHtml;
      setState('idle');
    }

    // ---- panels ----
    function card(tone, iconName, title, body, buttons) {
      var wrap = el('div', 'status-card status-card--' + tone);
      wrap.setAttribute('role', 'status');
      wrap.appendChild(icon(iconName, 'status-card__icon'));
      var content = el('div', 'status-card__body');
      content.appendChild(el('p', 'status-card__title', title));
      if (body) content.appendChild(el('p', 'status-card__text', body));
      if (buttons && buttons.length) {
        var row = el('div', 'status-card__actions');
        buttons.forEach(function (node) { row.appendChild(node); });
        content.appendChild(row);
      }
      wrap.appendChild(content);
      panel.replaceChildren(wrap);
      return wrap;
    }

    function showLoading() {
      var skeleton = el('div', 'skeleton');
      skeleton.setAttribute('aria-hidden', 'true');
      skeleton.appendChild(el('div', 'skeleton__line skeleton__line--head'));
      skeleton.appendChild(el('div', 'skeleton__line'));
      skeleton.appendChild(el('div', 'skeleton__media'));
      var wrap = el('div', 'loading');
      wrap.appendChild(skeleton);
      wrap.appendChild(el('p', 'loading__note', text.loadingNote));
      panel.replaceChildren(wrap);
      setState('loading');
    }

    function showInvalid(kind) {
      stopCountdown();
      panel.replaceChildren();
      markInvalid(true);
      showMessage(kind === 'profile' ? text.errNotSingle : kind === 'empty' ? text.errEmpty : text.errInvalid);
      setState('invalid');
      input.focus();
    }

    function startOver() {
      input.value = '';
      showIdle();
      input.focus();
    }

    function showUnavailable(url, noCopy) {
      stopCountdown();
      var check = button(text.unavailable.check, 'btn btn--outline btn--small', function () { checkSavedCopy(url); });
      var another = button(text.unavailable.another, 'btn btn--plain btn--small', startOver);
      card('error', 'cross', text.unavailable.title, noCopy ? text.unavailable.textNoCopy : text.unavailable.text, [check, another]);
      setState('unavailable');
    }

    function showRejected() {
      card('error', 'cross', text.rejected.title, text.rejected.text, [button(text.rejected.another, 'btn btn--outline btn--small', startOver)]);
      setState('rejected');
    }

    function showBusy(retry) {
      card('warn', 'clock', text.busy.title, text.busy.text, [button(text.busy.retry, 'btn btn--primary btn--small', retry)]);
      setState('busy');
    }

    function showTooMany(seconds, retry) {
      stopCountdown();
      var remaining = seconds;
      var retryButton = button('', 'btn btn--primary btn--small', retry);
      retryButton.disabled = true;
      retryButton.classList.add('is-disabled');
      function paint() {
        if (remaining > 0) {
          retryButton.textContent = Link.fillTemplate(text.tooMany.retryIn, { time: Link.formatCountdown(remaining) });
        } else {
          stopCountdown();
          retryButton.textContent = text.tooMany.retry;
          retryButton.disabled = false;
          retryButton.classList.remove('is-disabled');
        }
      }
      card('warn', 'hourglass', text.tooMany.title, text.tooMany.text, [retryButton]);
      paint();
      countdownTimer = timers.setInterval(function () { remaining -= 1; paint(); }, 1000);
      setState('tooMany');
    }

    function showSensitive(data, retryAfterConfirm) {
      var wrap = el('div', 'sensitive');
      var author = el('div', 'sensitive__author');
      author.appendChild(el('span', 'sensitive__avatar'));
      var names = el('div', 'sensitive__names');
      names.appendChild(el('strong', '', (data.author && data.author.name) || ''));
      names.appendChild(el('span', '', data.author && data.author.screen_name ? '@' + data.author.screen_name : ''));
      author.appendChild(names);
      var cover = el('div', 'sensitive__cover');
      cover.appendChild(icon('eyeOff'));
      cover.appendChild(el('p', 'sensitive__title', text.sensitive.title));
      cover.appendChild(el('p', 'sensitive__text', mode === 'home' ? text.sensitive.textDownload : text.sensitive.textView));
      var actions = el('div', 'sensitive__actions');
      actions.appendChild(button(text.sensitive.confirm, 'btn btn--primary', function () { confirmAge(retryAfterConfirm); }));
      actions.appendChild(button(text.sensitive.back, 'btn btn--outline', startOver));
      wrap.appendChild(author);
      wrap.appendChild(cover);
      wrap.appendChild(actions);
      panel.replaceChildren(wrap);
      setState('sensitive');
    }

    function showSaving() {
      var wrap = el('div', 'saving');
      wrap.setAttribute('role', 'status');
      var art = rootEl.querySelector('[data-saving-art]');
      if (art) { var artBox = el('div', 'saving__art'); artBox.innerHTML = art.innerHTML; wrap.appendChild(artBox); }
      wrap.appendChild(el('p', 'saving__title', text.saved.title));
      var bar = el('div', 'progress');
      bar.appendChild(el('span', 'progress__bar'));
      wrap.appendChild(bar);
      wrap.appendChild(el('p', 'saving__note', text.saved.note));
      panel.replaceChildren(wrap);
      setState('saving');
    }

    function formatDate(iso) {
      try { return new Intl.DateTimeFormat(config.lang === 'zh' ? 'zh-Hans' : config.lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)); }
      catch (error) { return String(iso).slice(0, 10); }
    }

    function showAlreadySaved(data) {
      var wrap = card('info', 'clock', Link.fillTemplate(text.saved.already, { date: formatDate(data.saved_at) }), text.saved.opening, []);
      setState('alreadySaved');
      timers.setTimeout(function () { navigate(data.url); }, MIN_SAVING_MS);
      return wrap;
    }

    // Phase 3 replaces this with the result cards; for now it lists the links.
    function showResult(data) {
      var groups = [];
      data.videos.forEach(function (video) { video.variants.forEach(function (v) { groups.push([text.result.video, v.resolution || '', v.url]); }); });
      data.gifs.forEach(function (gif) { groups.push([text.result.gif, gif.variants[0].resolution || '', gif.variants[0].url]); });
      data.images.forEach(function (image, index) { groups.push([text.result.image, '#' + (index + 1), image.orig_url]); });
      var wrap = el('div', 'result-temp');
      wrap.appendChild(el('p', 'result-temp__title', text.result.title));
      if (!groups.length) {
        wrap.appendChild(el('p', 'result-temp__none', text.result.none));
      } else {
        var list = el('ul', 'result-temp__list');
        groups.forEach(function (group) {
          if (!/^https:\/\//.test(group[2])) return;
          var item = el('li');
          var anchor = el('a', '', (group[0] + ' ' + group[1]).trim());
          anchor.href = group[2];
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          item.appendChild(anchor);
          list.appendChild(item);
        });
        wrap.appendChild(list);
      }
      panel.replaceChildren(wrap);
      setState('result');
    }

    // ---- network ----
    function postJson(url, body) {
      return fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      });
    }

    function showFailure(response, data, retry, url) {
      var kind = Link.classifyFailure(response && response.status, data && data.code);
      if (kind === 'tooMany') return showTooMany(Link.retryAfterSeconds(response && response.headers && response.headers.get('Retry-After')), retry);
      if (kind === 'invalid') return showInvalid('invalid');
      if (kind === 'unavailable') return showUnavailable(url, false);
      if (kind === 'rejected') return showRejected();
      return showBusy(retry);
    }

    function validate() {
      clearFeedback();
      var parsed = Link.parseXLink(input.value);
      if (parsed.status !== 'ok') { showInvalid(parsed.status); return null; }
      return parsed;
    }

    function runDownload() {
      var parsed = validate();
      if (!parsed) return Promise.resolve();
      current.action = runDownload;
      setBusy('download');
      showLoading();
      return postJson(endpoints.resolve, { url: parsed.url }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (response.ok && data && data.success) {
            if (data.requires_age_confirmation) return showSensitive(data, runDownload);
            return showResult(data);
          }
          return showFailure(response, data, runDownload, parsed.url);
        });
      }).catch(function () { showBusy(runDownload); }).then(function () { setBusy(null); });
    }

    function runView() {
      var parsed = validate();
      if (!parsed) return Promise.resolve();
      current.action = runView;
      setBusy('view');
      showSaving();
      var started = Date.now();
      var leaving = false; // the button stays busy while the browser navigates away
      return postJson(endpoints.archive, { url: parsed.url }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (response.ok && data && data.success && /^\/[A-Za-z0-9]{6}$/.test(data.url || '')) {
            leaving = true;
            if (data.cached) return showAlreadySaved(data);
            // Keep the "saving" screen up long enough to read (design 5.1: 1–2 s).
            var wait = Math.max(0, MIN_SAVING_MS - (Date.now() - started));
            return timers.setTimeout(function () { navigate(data.url); }, wait);
          }
          return showFailure(response, data, runView, parsed.url);
        });
      }).catch(function () { showBusy(runView); }).then(function () { if (!leaving) setBusy(null); });
    }

    function checkSavedCopy(url) {
      return postJson(endpoints.savedCopy, { url: url }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (response.ok && data && data.found) return showAlreadySaved(data);
          if (response.status === 429) return showTooMany(Link.retryAfterSeconds(response.headers.get('Retry-After')), function () { checkSavedCopy(url); });
          return showUnavailable(url, true);
        });
      }).catch(function () { showBusy(function () { checkSavedCopy(url); }); });
    }

    function confirmAge(retry) {
      return postJson(endpoints.ageConfirm, {}).then(function (response) {
        if (!response.ok) throw new Error('age');
        return retry();
      }).catch(function () { showBusy(function () { confirmAge(retry); }); });
    }

    // ---- paste and clipboard ----
    function fill(value) {
      input.value = value;
      clipboardHint.hidden = true;
      clipboardCandidate = null;
      clearFeedback();
      if (rootEl.getAttribute('data-state') === 'invalid') setState('idle');
    }

    function paste() {
      if (!clipboard || !clipboard.readText) { showMessage(text.pasteFailed, 'info'); input.focus(); return Promise.resolve(); }
      return clipboard.readText().then(function (value) {
        if (value && value.trim()) { fill(value.trim()); input.focus(); } else { showMessage(text.pasteFailed, 'info'); }
      }).catch(function () { showMessage(text.pasteFailed, 'info'); input.focus(); });
    }

    // Only when the browser already granted clipboard access: never prompt on load.
    function detectClipboard() {
      if (!permissions || !permissions.query || !clipboard || !clipboard.readText) return Promise.resolve();
      return permissions.query({ name: 'clipboard-read' }).then(function (status) {
        if (!status || status.state !== 'granted') return null;
        return clipboard.readText();
      }).then(function (value) {
        if (!value) return;
        var parsed = Link.parseXLink(value);
        if (parsed.status === 'ok' && !input.value) { clipboardCandidate = value.trim(); clipboardHint.hidden = false; }
      }).catch(function () { /* unsupported or denied: no hint */ });
    }

    // ---- wiring ----
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (mode === 'home') runDownload(); else runView();
    });
    if (viewButton && mode === 'home') viewButton.addEventListener('click', function () { runView(); });
    pasteButton.addEventListener('click', paste);
    clipboardHint.addEventListener('click', function () { if (clipboardCandidate) { fill(clipboardCandidate); input.focus(); } });
    input.addEventListener('input', function () {
      markInvalid(false);
      showMessage('');
      if (rootEl.getAttribute('data-state') === 'invalid') { panel.innerHTML = idleHtml; setState('idle'); }
    });

    detectClipboard();

    return { runDownload: runDownload, runView: runView, paste: paste, detectClipboard: detectClipboard, state: function () { return rootEl.getAttribute('data-state'); } };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createFinder: createFinder };
  else if (root.document) {
    root.document.querySelectorAll('[data-finder]').forEach(function (node) { createFinder({ root: node, win: root }); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
