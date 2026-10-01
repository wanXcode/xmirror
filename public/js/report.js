// Report / removal form: validates, prefills ?post=CODE, and posts to /api/reports.
(function (root) {
  var CODE = /^[A-Za-z0-9]{6}$/;

  function fillTemplate(text, values) {
    return String(text).replace(/\{(\w+)\}/g, function (whole, key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole; });
  }

  // The reason always starts with a short code so it is never too short and the reviewer sees the choice.
  function buildPayload(values, reasons) {
    var chosen = null;
    for (var i = 0; i < reasons.length; i += 1) if (reasons[i].value === values.reason) chosen = reasons[i];
    if (!chosen) chosen = reasons[reasons.length - 1];
    var details = String(values.details || '').trim();
    return {
      url: String(values.url || '').trim(),
      kind: chosen.kind,
      reason: '[' + chosen.value + '] ' + (values.reasonLabel || chosen.value) + (details ? ' — ' + details : ''),
      contact: String(values.contact || '').trim(),
      website: values.website || ''
    };
  }

  function init(doc, win, fetchImpl) {
    var form = doc.querySelector('[data-report-form]');
    var configNode = doc.querySelector('[data-report-config]');
    if (!form || !configNode) return null;
    var config = JSON.parse(configNode.textContent);
    var field = function (name) { return form.querySelector('[name=' + name + ']'); };
    var status = form.querySelector('[data-status]');
    var button = form.querySelector('[data-submit]');
    var params = new win.URLSearchParams(win.location.search);
    var prefill = params.get('post');
    if (CODE.test(prefill || '')) field('url').value = win.location.origin + '/' + prefill;

    function say(text, isError) {
      status.textContent = text;
      status.classList.toggle('is-error', Boolean(isError));
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var checked = form.querySelector('input[name=reason]:checked');
      var label = checked && checked.parentNode.textContent.trim();
      var values = {
        url: field('url').value, reason: checked ? checked.value : '', reasonLabel: label,
        contact: field('contact').value, details: field('details').value, website: field('website').value
      };
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact.trim());
      if (!values.url.trim() || !emailOk || !field('confirm').checked) { say(config.messages.invalid, true); return; }
      button.disabled = true;
      button.textContent = config.sending;
      say('', false);
      fetchImpl('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload(values, config.reasons)) })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) { return { status: response.status, body: body }; });
        })
        .then(function (result) {
          if (result.status === 201 || result.status === 202) {
            say(result.body && result.body.id ? fillTemplate(config.messages.sent, { id: result.body.id }) : config.messages.sentNoId, false);
            if (typeof form.reset === 'function') form.reset();
          } else if (result.status === 404) say(config.messages.notFound, true);
          else if (result.status === 429) say(config.messages.tooMany, true);
          else if (result.status === 400) say(config.messages.invalid, true);
          else say(config.messages.failed, true);
        }, function () { say(config.messages.failed, true); })
        .then(function () { button.disabled = false; button.textContent = config.submit; });
    });
    return { form: form };
  }

  var api = { init: init, buildPayload: buildPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) init(root.document, root, root.fetch.bind(root));
})(typeof window !== 'undefined' ? window : globalThis);
