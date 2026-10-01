// "Copy link" buttons: [data-copy] copies its value; the nearest [data-copy-root] shows a short confirmation.
(function (root) {
  function init(doc, nav, timers) {
    var buttons = doc.querySelectorAll('[data-copy]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-copy');
        var scope = button.closest('[data-copy-root]');
        var status = scope && scope.querySelector('[data-copy-status]');
        var done = function () {
          if (!status) return;
          status.textContent = scope.getAttribute('data-copied') || '';
          (timers || root).setTimeout(function () { status.textContent = ''; }, 2500);
        };
        if (nav && nav.clipboard && nav.clipboard.writeText) {
          nav.clipboard.writeText(value).then(done, function () {});
        }
      });
    });
    return buttons.length;
  }
  var api = { init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) init(root.document, root.navigator, root);
})(typeof window !== 'undefined' ? window : globalThis);
