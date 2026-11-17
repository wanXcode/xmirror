// Personal archive page: create/reset the shortcut key, claim old links, remove list entries, sign out.
(function (root) {
  function init(doc, win) {
    var page = doc.querySelector('[data-me]');
    if (!page) return false;
    var q = function (sel) { return page.querySelector(sel); };
    var fetchJson = function (url, options) {
      options = options || {};
      options.credentials = 'same-origin';
      options.headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
      return win.fetch(url, options).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) { return { ok: response.ok, body: body }; });
      });
    };
    var show = function (el, text) { el.textContent = text || ''; el.hidden = !text; };

    var keyButton = q('[data-me-key]');
    if (keyButton) keyButton.addEventListener('click', function () {
      var error = q('[data-me-key-error]');
      show(error, '');
      keyButton.disabled = true;
      fetchJson('/api/me/key', { method: 'POST', body: '{}' }).then(function (result) {
        keyButton.disabled = false;
        if (!result.ok || !result.body.key) return show(error, page.getAttribute('data-key-failed'));
        q('[data-me-key-value]').textContent = result.body.key;
        q('[data-me-url-value]').textContent = page.getAttribute('data-quick-base') + '/api/archive/quick?format=text&key=' + result.body.key + '&url=';
        q('[data-me-secret]').hidden = false;
      }, function () { keyButton.disabled = false; show(error, page.getAttribute('data-key-failed')); });
    });

    Array.prototype.forEach.call(page.querySelectorAll('[data-me-copy]'), function (button) {
      button.addEventListener('click', function () {
        var target = q(button.getAttribute('data-me-copy') === 'key' ? '[data-me-key-value]' : '[data-me-url-value]');
        var original = button.textContent;
        if (win.navigator && win.navigator.clipboard) {
          win.navigator.clipboard.writeText(target.textContent).then(function () {
            button.textContent = page.getAttribute('data-copied');
            win.setTimeout(function () { button.textContent = original; }, 2000);
          }, function () {});
        }
      });
    });

    var claim = q('[data-me-claim]');
    if (claim) claim.addEventListener('click', function () {
      var status = q('[data-me-claim-status]');
      var text = q('[data-me-claim-text]').value;
      if (!text.trim()) return;
      claim.disabled = true;
      fetchJson('/api/me/archives/claim', { method: 'POST', body: JSON.stringify({ text: text }) }).then(function (result) {
        claim.disabled = false;
        if (!result.ok || !result.body.success) return show(status, page.getAttribute('data-claim-failed'));
        var b = result.body;
        show(status, page.getAttribute('data-claim-result').replace('{added}', b.added).replace('{already}', b.already).replace('{missing}', b.missing));
        if (b.added > 0) win.setTimeout(function () { win.location.reload(); }, 1200);
      }, function () { claim.disabled = false; show(status, page.getAttribute('data-claim-failed')); });
    });

    Array.prototype.forEach.call(page.querySelectorAll('[data-me-remove]'), function (button) {
      button.addEventListener('click', function () {
        var error = q('[data-me-list-error]');
        button.disabled = true;
        fetchJson('/api/me/archives/' + encodeURIComponent(button.getAttribute('data-me-remove')), { method: 'DELETE' }).then(function (result) {
          if (!result.ok) { button.disabled = false; return show(error, page.getAttribute('data-list-failed')); }
          win.location.reload();
        }, function () { button.disabled = false; show(error, page.getAttribute('data-list-failed')); });
      });
    });

    var logout = q('[data-me-logout]');
    if (logout) logout.addEventListener('click', function () {
      fetchJson('/auth/logout', { method: 'POST', body: '{}' }).then(function () { win.location.reload(); });
    });
    return true;
  }
  var api = { init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) init(root.document, root);
})(typeof window !== 'undefined' ? window : globalThis);
