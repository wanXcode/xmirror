// Result cards (docs/design: W_Results, W_Feedback): one card per resolved post with a block
// per media type, download buttons with progress, photo selection, full-screen photos,
// platform tips and the "View & save a copy" shortcut. Everything the page needs from the
// outside (DOM, network, navigator, timers) arrives in `ctx`, so it can be driven in tests.
(function (root) {
  var Download = typeof require === 'function' ? require('./download') : root.XPutDownload;
  var Zip = typeof require === 'function' ? require('./zip') : root.XPutZip;
  var Link = typeof require === 'function' ? require('./link') : root.XPutLink;

  var ICON = {
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none"/>',
    gif: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 10.5H7a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1v-1H7.2M11 10.5v3M14 13.5v-3h2M14 12h1.5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>'
  };

  var SAVED_MS = 3000;
  var FAILED_MS = 5000;
  var TIP_MS = 12000;
  var SWIPE_PX = 40;

  function isHttps(url) { return /^https:\/\//i.test(String(url || '')); }

  // pbs.twimg.com/media/X?format=jpg&name=orig -> same image at another size
  function sized(url, size) { return String(url).replace(/([?&]name=)[a-z0-9]+/i, '$1' + size); }

  function t(text, key, values) { return Link.fillTemplate(text[key], values || {}); }

  // ---------------------------------------------------------------- pure helpers (tested)
  function mediaCounts(data) {
    return { videos: (data.videos || []).length, gifs: (data.gifs || []).length, photos: (data.images || []).length };
  }
  function hasMedia(counts) { return counts.videos + counts.gifs + counts.photos > 0; }

  // "Video", "4 photos", "1 video · 2 photos", or "Quoted video" when only the quote has media.
  function buildPill(data, text) {
    var own = mediaCounts(data);
    var quote = data.quote ? mediaCounts(data.quote) : { videos: 0, gifs: 0, photos: 0 };
    var kinds = (own.videos ? 1 : 0) + (own.gifs ? 1 : 0) + (own.photos ? 1 : 0);
    if (!hasMedia(own)) {
      if (!hasMedia(quote)) return '';
      var quoteKinds = (quote.videos ? 1 : 0) + (quote.gifs ? 1 : 0) + (quote.photos ? 1 : 0);
      if (quoteKinds > 1) return text.pillQuotedMedia;
      return quote.videos ? text.pillQuotedVideo : quote.gifs ? text.pillQuotedGif : text.pillQuotedPhotos;
    }
    var parts = [];
    if (own.videos) parts.push(kinds === 1 && own.videos === 1 ? text.pillVideo : own.videos === 1 ? t(text, 'pillVideoCount', { n: 1 }) : t(text, 'pillVideos', { n: own.videos }));
    if (own.gifs) parts.push(own.gifs === 1 ? text.pillGif : t(text, 'pillGifs', { n: own.gifs }));
    if (own.photos) parts.push(own.photos === 1 ? text.pillPhoto : t(text, 'pillPhotos', { n: own.photos }));
    return parts.join(' · ');
  }

  function primaryQualityLabel(variant, text) {
    var quality = Download.qualityOf(variant);
    return !variant.height || variant.height >= 720 ? t(text, 'hdQuality', { quality: quality }) : quality;
  }

  // ---------------------------------------------------------------- the renderer
  function createResultRenderer(ctx) {
    var doc = ctx.doc;
    var win = ctx.win;
    var text = ctx.text;
    var platform = ctx.platform || { ios: false, android: false, mobile: false };
    var nav = ctx.nav || (win && win.navigator) || {};
    var timers = ctx.timers || { setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win), setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win) };
    var fetchFn = ctx.fetch;
    var toast = null;
    var toastTimer = null;
    var save = ctx.saveBlob || function (blob, name) { Download.saveBlob(doc, win, blob, name); };
    var navigateTo = ctx.navigate || function (url) { win.location.assign(url); };

    function h(tag, props, children) {
      var node = doc.createElement(tag);
      Object.keys(props || {}).forEach(function (key) {
        var value = props[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') Object.keys(value).forEach(function (event) { node.addEventListener(event, value[event]); });
        else node.setAttribute(key, value === true ? '' : String(value));
      });
      [].concat(children || []).forEach(function (child) {
        if (child === null || child === undefined || child === false) return;
        node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
      });
      return node;
    }

    function icon(name, size) {
      var span = h('span', { class: 'ico', 'aria-hidden': 'true' });
      span.innerHTML = '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + ICON[name] + '</svg>';
      return span;
    }

    // ------------------------------------------------------------ sizes (filled in when known)
    var sizes = {};
    var sizeListeners = [];
    function onSize(url, listener) { sizeListeners.push({ url: url, listener: listener }); if (sizes[url]) listener(sizes[url]); }
    function loadSizes(urls) {
      if (!ctx.fetchSizes || !urls.length) return Promise.resolve();
      return ctx.fetchSizes(urls).then(function (found) {
        Object.keys(found || {}).forEach(function (url) {
          if (!found[url]) return;
          sizes[url] = found[url];
          sizeListeners.forEach(function (entry) { if (entry.url === url) entry.listener(found[url]); });
        });
      }).catch(function () { /* sizes are a nicety; the buttons work without them */ });
    }

    // ------------------------------------------------------------ platform tip
    function closeToast() {
      if (toastTimer) { timers.clearTimeout(toastTimer); toastTimer = null; }
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
      toast = null;
    }
    function showTip() {
      if (!platform.mobile) return;
      closeToast();
      var iosTip = platform.ios;
      var body = h('div', { class: 'toast__body' }, [
        h('p', { class: 'toast__title', text: iosTip ? text.tipIosTitle : text.tipAndroidTitle }),
        h('p', { class: 'toast__text', text: iosTip ? text.tipIosText : text.tipAndroidText }),
        iosTip ? h('a', { class: 'toast__link', href: ctx.shortcutHref || '/ios-shortcut', text: text.tipIosLink }) : null
      ]);
      toast = h('div', { class: 'toast', role: 'status' }, [
        icon(iosTip ? 'info' : 'download', 20), body,
        h('button', { class: 'toast__close', type: 'button', 'aria-label': text.dismiss, on: { click: closeToast } }, [icon('close', 16)])
      ]);
      doc.body.appendChild(toast);
      toastTimer = timers.setTimeout(closeToast, TIP_MS);
    }

    // ------------------------------------------------------------ download button state machine
    // statusEl shows "Download…/46%/Saved"; idleText() is what it says at rest.
    function wireDownload(options) {
      var button = options.button;
      var statusEl = options.statusEl;
      var busy = false;
      var restoreTimer = null;
      var countdown = null;

      function idle() {
        button.classList.remove('is-busy', 'is-saved', 'is-failed');
        button.disabled = false;
        button.removeAttribute('aria-busy');
        statusEl.textContent = options.idleText();
        if (options.sizeEl) options.sizeEl.hidden = false;
        if (options.iconEl) options.iconEl.replaceChildren(icon('download', 18));
      }
      function set(state, label) {
        button.classList.remove('is-busy', 'is-saved', 'is-failed');
        button.classList.add(state);
        statusEl.textContent = label;
        if (options.sizeEl) options.sizeEl.hidden = true;
      }
      function later(ms) {
        if (restoreTimer) timers.clearTimeout(restoreTimer);
        restoreTimer = timers.setTimeout(function () { restoreTimer = null; idle(); }, ms);
      }
      function stopCountdown() { if (countdown) { timers.clearInterval(countdown); countdown = null; } }

      function progress(done, total) {
        var label = total > 0 ? t(text, 'downloadingPercent', { percent: Math.min(100, Math.round((done / total) * 100)) }) : text.downloading;
        statusEl.textContent = label;
      }

      function run() {
        if (busy || button.disabled) return Promise.resolve();
        busy = true;
        stopCountdown();
        if (restoreTimer) { timers.clearTimeout(restoreTimer); restoreTimer = null; }
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        set('is-busy', text.downloading);
        return Promise.resolve().then(function () { return options.task(progress); }).then(function (outcome) {
          busy = false;
          button.disabled = false;
          button.removeAttribute('aria-busy');
          if (outcome && outcome.cancelled) { idle(); return; }
          set('is-saved', text.saved);
          if (options.iconEl) options.iconEl.replaceChildren(icon('check', 18));
          later(SAVED_MS);
          if (options.onSaved) options.onSaved(outcome || {});
        }).catch(function (error) {
          busy = false;
          button.removeAttribute('aria-busy');
          if (error && error.status === 429) {
            var remaining = error.retryAfter || 60;
            button.disabled = true;
            set('is-failed', t(text, 'retryIn', { time: Link.formatCountdown(remaining) }));
            countdown = timers.setInterval(function () {
              remaining -= 1;
              if (remaining <= 0) { stopCountdown(); idle(); return; }
              statusEl.textContent = t(text, 'retryIn', { time: Link.formatCountdown(remaining) });
            }, 1000);
            return;
          }
          button.disabled = false;
          set('is-failed', text.failed);
          later(FAILED_MS);
        });
      }

      button.addEventListener('click', run);
      idle();
      return { run: run, refresh: function () { if (!busy && !button.classList.contains('is-saved') && !button.classList.contains('is-failed')) statusEl.textContent = options.idleText(); } };
    }

    // ------------------------------------------------------------ download tasks
    function proxy(url, name) { return Download.proxyUrl(ctx.downloadBase, url, name); }

    function downloadVideoTask(variant, name) {
      return function (progress) {
        var url = proxy(variant.url, name);
        if ((sizes[variant.url] || 0) > Download.LARGE_BYTES) {
          // Too big to hold in memory: hand the proxy URL to the browser's own download manager.
          navigateTo(url);
          return { kind: 'video' };
        }
        return Download.fetchBlob(fetchFn, url, progress).then(function (blob) { save(blob, name); return { kind: 'video' }; });
      };
    }

    function fetchPhotos(images, names, progress) {
      var done = new Array(images.length).fill(0);
      var total = new Array(images.length).fill(0);
      return Promise.all(images.map(function (image, index) {
        return Download.fetchBlob(fetchFn, proxy(image.orig_url, names[index]), function (received, size) {
          done[index] = received; total[index] = size;
          var sum = total.reduce(function (a, b) { return a + b; }, 0);
          progress(done.reduce(function (a, b) { return a + b; }, 0), sum && total.every(Boolean) ? sum : 0);
        });
      }));
    }

    // Names keep the photo's position in the post (xput_20_2.jpg) even when only some are saved,
    // so two separate saves from one post never collide.
    function photoNames(data, images, total) {
      return images.map(function (image) {
        return Download.fileName(['xput', data.id, total > 1 ? image.n : ''], Download.extensionOf(image.orig_url, 'jpg'));
      });
    }

    // Phones: the system share sheet (Save to Photos). Computers: a ZIP, or the file itself for one photo.
    function downloadPhotosTask(data, images, total) {
      return function (progress) {
        var names = photoNames(data, images, total);
        return fetchPhotos(images, names, progress).then(function (blobs) {
          if (platform.mobile) {
            var files = blobs.map(function (blob, i) { return new (ctx.File || win.File)([blob], names[i], { type: blob.type || 'image/jpeg' }); });
            if (Download.canShareFiles(nav, files)) {
              return nav.share({ files: files }).then(function () { return { kind: 'photos', shared: true }; }, function (error) {
                if (error && error.name === 'AbortError') return { cancelled: true };
                blobs.forEach(function (blob, i) { save(blob, names[i]); });
                return { kind: 'photos' };
              });
            }
            blobs.forEach(function (blob, i) { save(blob, names[i]); });
            return { kind: 'photos' };
          }
          if (blobs.length === 1) { save(blobs[0], names[0]); return { kind: 'photos' }; }
          return Promise.all(blobs.map(function (blob) { return blob.arrayBuffer(); })).then(function (buffers) {
            var archive = Zip.createZip(buffers.map(function (buffer, i) { return { name: names[i], data: new Uint8Array(buffer) }; }));
            save(new Blob([archive], { type: 'application/zip' }), Download.fileName(['xput', data.id, 'photos'], 'zip'));
            return { kind: 'photos' };
          });
        });
      };
    }

    // ------------------------------------------------------------ blocks
    function blockLabel(iconName, label) {
      return h('div', { class: 'block__label' }, [icon(iconName, 16), h('span', { text: label })]);
    }

    function previewBox(opts) {
      var ratio = opts.width && opts.height ? opts.width + ' / ' + opts.height : '16 / 9';
      var box = h('div', { class: 'preview', style: '--ratio:' + ratio });
      if (opts.thumbnail && isHttps(opts.thumbnail)) box.appendChild(h('img', { class: 'preview__poster', src: opts.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
      return box;
    }

    function mountVideo(box, src, poster, loop) {
      var video = h('video', { class: 'preview__video', src: src, muted: true, playsinline: true, loop: loop ? true : null, controls: loop ? null : true, autoplay: true, poster: poster && isHttps(poster) ? poster : null });
      video.muted = true;
      box.replaceChildren(video);
      if (video.play) { try { var attempt = video.play(); if (attempt && attempt.catch) attempt.catch(function () {}); } catch (error) { /* autoplay may be blocked; controls remain */ } }
      return video;
    }

    function videoBlock(data, video, index, prefix) {
      var best = video.variants[0];
      var duration = Download.formatDuration(video.duration);
      var label = duration
        ? t(text, 'labelVideo', { quality: Download.qualityOf(best), duration: duration })
        : t(text, 'labelVideoNoDuration', { quality: Download.qualityOf(best) });
      var box = previewBox({ thumbnail: video.thumbnail, width: video.width, height: video.height });
      var play = h('button', { class: 'preview__play', type: 'button', 'aria-label': text.play, on: { click: function () { mountVideo(box, Download.pickPreviewVariant(video.variants).url, video.thumbnail, false); } } }, [icon('play', 24)]);
      box.appendChild(play);
      if (duration) box.appendChild(h('span', { class: 'preview__duration', text: duration }));

      var nameFor = function (variant) { return Download.fileName(['xput', data.id, prefix, video.variants.length > 1 || index ? Download.qualityOf(variant) : ''], 'mp4'); };
      var main = h('button', { class: 'dl', type: 'button' });
      var mainIcon = h('span', { class: 'dl__icon' }, [icon('download', 18)]);
      var mainLabel = h('span', { class: 'dl__label' });
      var mainSize = h('span', { class: 'dl__size' });
      main.appendChild(h('span', { class: 'dl__left' }, [mainIcon, mainLabel]));
      main.appendChild(mainSize);
      var mainControl = wireDownload({
        button: main, statusEl: mainLabel, sizeEl: mainSize, iconEl: mainIcon,
        idleText: function () { return primaryQualityLabel(best, text); },
        task: downloadVideoTask(best, nameFor(best)), onSaved: afterDownload
      });
      onSize(best.url, function (bytes) { mainSize.textContent = Download.formatBytes(bytes); });

      var block = h('section', { class: 'block block--video' }, [blockLabel('video', label), box, main]);

      var others = video.variants.slice(1);
      if (others.length) {
        var list = h('div', { class: 'variants', hidden: true });
        var toggle = h('button', { class: 'toggle', type: 'button', 'aria-expanded': 'false' }, [h('span', { text: text.otherQualities }), h('span', { class: 'toggle__arrow', 'aria-hidden': 'true', text: '▾' })]);
        others.forEach(function (variant) {
          var row = h('button', { class: 'variant', type: 'button' });
          var name = h('span', { class: 'variant__name', text: t(text, 'qualityMp4', { quality: Download.qualityOf(variant) }) });
          var status = h('span', { class: 'variant__status' });
          row.appendChild(name); row.appendChild(status);
          var control = wireDownload({
            button: row, statusEl: status,
            idleText: function () { return sizes[variant.url] ? t(text, 'variantDownloadSize', { size: Download.formatBytes(sizes[variant.url]) }) : text.variantDownload; },
            task: downloadVideoTask(variant, nameFor(variant)), onSaved: afterDownload
          });
          onSize(variant.url, function () { control.refresh(); });
          list.appendChild(row);
        });
        toggle.addEventListener('click', function () {
          var open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open));
          toggle.querySelector('.toggle__arrow').textContent = open ? '▴' : '▾';
          list.hidden = !open;
        });
        block.appendChild(toggle);
        block.appendChild(list);
      }
      block.__mainControl = mainControl;
      return block;
    }

    function gifBlock(data, gif, index, prefix) {
      var variant = gif.variants[0];
      var duration = Download.formatDuration(gif.duration);
      var box = previewBox({ thumbnail: gif.thumbnail, width: gif.width, height: gif.height });
      mountVideo(box, variant.url, gif.thumbnail, true);
      box.appendChild(h('span', { class: 'preview__tag', text: text.gifLoops }));
      var main = h('button', { class: 'dl', type: 'button' });
      var mainIcon = h('span', { class: 'dl__icon' }, [icon('download', 18)]);
      var mainLabel = h('span', { class: 'dl__label' });
      var mainSize = h('span', { class: 'dl__size' });
      main.appendChild(h('span', { class: 'dl__left' }, [mainIcon, mainLabel]));
      main.appendChild(mainSize);
      wireDownload({
        button: main, statusEl: mainLabel, sizeEl: mainSize, iconEl: mainIcon,
        idleText: function () { return text.gifButton; },
        task: downloadVideoTask(variant, Download.fileName(['xput', data.id, prefix, index ? 'gif' + (index + 1) : 'gif'], 'mp4')), onSaved: afterDownload
      });
      onSize(variant.url, function (bytes) { mainSize.textContent = Download.formatBytes(bytes); });
      return h('section', { class: 'block block--gif' }, [
        blockLabel('gif', duration ? t(text, 'labelGif', { duration: duration }) : text.labelGifNoDuration),
        box, main, h('p', { class: 'block__note', text: text.gifNote })
      ]);
    }

    function numbered(images) {
      return images.map(function (image, index) { return Object.assign({}, image, { n: index + 1 }); });
    }

    function photosBlock(data, list) {
      var images = numbered(list);
      var selected = images.map(function () { return true; });
      var grid = h('div', { class: 'photos photos--' + Math.min(images.length, 4) });
      var label = images.length === 1 ? text.labelPhoto : t(text, 'labelPhotos', { n: images.length });
      var mainIcon = h('span', { class: 'dl__icon' }, [icon('download', 18)]);
      var mainLabel = h('span', { class: 'dl__label' });
      var main = h('button', { class: 'dl', type: 'button' }, [h('span', { class: 'dl__left' }, [mainIcon, mainLabel]), h('span', { class: 'dl__size', text: text.originalSize })]);
      var control;

      function chosen() { return images.filter(function (image, i) { return selected[i]; }); }
      function idleText() {
        var n = chosen().length;
        if (!n) return text.selectSome;
        if (platform.mobile) return n === 1 ? text.saveOneToPhotos : t(text, 'saveToPhotos', { n: n });
        return n === 1 ? text.zipOne : t(text, 'zip', { n: n });
      }

      images.forEach(function (image, index) {
        var check = h('button', { class: 'photo__check is-on', type: 'button', role: 'checkbox', 'aria-checked': 'true', 'aria-label': t(text, 'selectPhoto', { n: index + 1 }) }, [icon('check', 14)]);
        check.addEventListener('click', function () {
          selected[index] = !selected[index];
          check.classList.toggle('is-on', selected[index]);
          check.setAttribute('aria-checked', String(selected[index]));
          main.disabled = chosen().length === 0;
          control.refresh();
        });
        var open = h('button', { class: 'photo__open', type: 'button', 'aria-label': t(text, 'openPhoto', { n: index + 1 }), on: { click: function () { openLightbox(data, images, index); } } }, [
          h('img', { src: sized(image.orig_url, 'medium'), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        ]);
        grid.appendChild(h('div', { class: 'photo' }, [open, check]));
      });

      control = wireDownload({
        button: main, statusEl: mainLabel, iconEl: mainIcon,
        idleText: idleText,
        task: function (progress) { return downloadPhotosTask(data, chosen(), images.length)(progress); },
        onSaved: afterDownload
      });
      return h('section', { class: 'block block--photos' }, [
        blockLabel('image', label), grid, h('p', { class: 'block__note', text: text.photosHint }), main
      ]);
    }

    // ------------------------------------------------------------ full-screen photos
    function openLightbox(data, images, start) {
      var index = start;
      var previousFocus = doc.activeElement;
      var touchX = null;
      var counter = h('span', { class: 'lightbox__counter' });
      var image = h('img', { class: 'lightbox__image', alt: '', referrerpolicy: 'no-referrer' });
      var saveLabel = h('span', { text: text.saveThisPhoto });
      var saveButton = h('button', { class: 'btn btn--primary lightbox__save', type: 'button' }, [icon('download', 18), saveLabel]);
      var closeButton = h('button', { class: 'lightbox__close', type: 'button', 'aria-label': text.close }, [icon('close', 20)]);
      var prev = h('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', 'aria-label': text.previous }, [icon('chevronLeft', 22)]);
      var next = h('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', 'aria-label': text.next }, [icon('chevronRight', 22)]);
      var overlay = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': text.lightboxLabel }, [
        h('div', { class: 'lightbox__bar' }, [counter, closeButton]),
        h('div', { class: 'lightbox__stage' }, [images.length > 1 ? prev : null, image, images.length > 1 ? next : null]),
        h('div', { class: 'lightbox__foot' }, [saveButton, h('p', { class: 'lightbox__hint', text: text.pressHold })])
      ]);

      function show(i) {
        index = (i + images.length) % images.length;
        image.src = sized(images[index].orig_url, 'large');
        counter.textContent = t(text, 'lightboxCounter', { index: index + 1, total: images.length });
      }
      function close() {
        doc.removeEventListener('keydown', onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        doc.documentElement.classList.remove('has-lightbox');
        if (previousFocus && previousFocus.focus) previousFocus.focus();
      }
      function onKey(event) {
        if (event.key === 'Escape') close();
        else if (event.key === 'ArrowLeft' && images.length > 1) show(index - 1);
        else if (event.key === 'ArrowRight' && images.length > 1) show(index + 1);
      }
      closeButton.addEventListener('click', close);
      prev.addEventListener('click', function () { show(index - 1); });
      next.addEventListener('click', function () { show(index + 1); });
      overlay.addEventListener('touchstart', function (event) { touchX = event.touches && event.touches[0] ? event.touches[0].clientX : null; });
      overlay.addEventListener('touchend', function (event) {
        var end = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : null;
        if (touchX === null || end === null || images.length < 2) return;
        if (end - touchX > SWIPE_PX) show(index - 1); else if (touchX - end > SWIPE_PX) show(index + 1);
        touchX = null;
      });
      doc.addEventListener('keydown', onKey);

      wireDownload({
        button: saveButton, statusEl: saveLabel,
        idleText: function () { return text.saveThisPhoto; },
        task: function (progress) { return downloadPhotosTask(data, [images[index]], images.length)(progress); },
        onSaved: afterDownload
      });

      show(index);
      doc.body.appendChild(overlay);
      doc.documentElement.classList.add('has-lightbox');
      if (closeButton.focus) closeButton.focus();
      return { close: close, show: show, overlay: overlay };
    }

    // ------------------------------------------------------------ card assembly
    var firstDownload = null;

    function afterDownload(outcome) {
      if (firstDownload) firstDownload(outcome);
      if (!outcome.shared && (outcome.kind === 'video' || outcome.kind === 'photos')) showTip();
    }

    function header(data, pill) {
      var avatar = data.author && isHttps(data.author.avatar_url)
        ? h('img', { class: 'card__avatar', src: data.author.avatar_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : h('span', { class: 'card__avatar card__avatar--blank' });
      return h('div', { class: 'card__head' }, [
        h('div', { class: 'card__author' }, [avatar, h('div', { class: 'card__names' }, [
          h('strong', { text: (data.author && data.author.name) || '' }),
          h('span', { text: data.author && data.author.screen_name ? '@' + data.author.screen_name : '' })
        ])]),
        pill ? h('span', { class: 'pill', text: pill }) : null
      ]);
    }

    function mediaBlocks(data, prefix) {
      var blocks = [];
      (data.videos || []).forEach(function (video, i) { blocks.push(videoBlock(data, video, i, prefix)); });
      (data.gifs || []).forEach(function (gif, i) { blocks.push(gifBlock(data, gif, i, prefix)); });
      if ((data.images || []).length) blocks.push(photosBlock(data, data.images));
      return blocks;
    }

    function collectSizeUrls(data) {
      var urls = [];
      [data, data.quote].forEach(function (source) {
        if (!source) return;
        (source.videos || []).forEach(function (video) { video.variants.forEach(function (v) { urls.push(v.url); }); });
        (source.gifs || []).forEach(function (gif) { urls.push(gif.variants[0].url); });
      });
      return urls.slice(0, 10);
    }

    function viewSaveButton(data, className) {
      return h('button', { class: className, type: 'button', on: { click: function () { if (ctx.onViewSave) ctx.onViewSave(data.url); } } }, [icon('eye', 18), h('span', { text: text.viewSave })]);
    }
    function openOnX(data, className) {
      return h('a', { class: className, href: data.url, target: '_blank', rel: 'noopener noreferrer' }, [h('span', { text: text.openOnX }), icon('external', 16)]);
    }

    function render(data) {
      var counts = mediaCounts(data);
      var quote = data.quote && hasMedia(mediaCounts(data.quote)) ? data.quote : null;
      var card = h('article', { class: 'rcard' });
      card.appendChild(header(data, buildPill(data, text)));

      if (!hasMedia(counts) && !quote) {
        // Text-only: the whole text, a note, and the actions that still make sense.
        var copy = h('button', { class: 'btn btn--plain btn--small', type: 'button' }, [h('span', { text: text.copyText })]);
        copy.addEventListener('click', function () {
          var nav_ = nav.clipboard;
          if (!nav_ || !nav_.writeText) return;
          nav_.writeText(data.text || '').then(function () {
            copy.firstChild.textContent = text.copied;
            timers.setTimeout(function () { copy.firstChild.textContent = text.copyText; }, 2000);
          }).catch(function () {});
        });
        card.appendChild(h('p', { class: 'rcard__text rcard__text--full', text: data.text || '' }));
        card.appendChild(h('div', { class: 'note' }, [icon('info', 16), h('span', { text: text.noMedia })]));
        card.appendChild(h('div', { class: 'rcard__actions' }, [viewSaveButton(data, 'btn btn--primary btn--small'), copy, openOnX(data, 'btn btn--plain btn--small')]));
        return card;
      }

      if (data.text) card.appendChild(h('p', { class: 'rcard__text', text: data.text }));
      var blocks = h('div', { class: 'blocks' }, mediaBlocks(data, ''));
      if (blocks.childNodes.length) card.appendChild(blocks);
      if (quote) {
        var quoted = h('div', { class: 'quoted' }, [
          h('p', { class: 'quoted__title', text: t(text, 'fromQuoted', { handle: (quote.author && quote.author.screen_name) || '' }) }),
          h('div', { class: 'blocks' }, mediaBlocks(Object.assign({}, quote, { id: quote.id || data.id + '_quote' }), 'quote'))
        ]);
        card.appendChild(quoted);
      }

      var hint = null;
      firstDownload = function () {
        if (hint) return;
        hint = h('div', { class: 'last-hint' }, [icon('clock', 18), h('span', {}, [text.lastHint + ' ', viewSaveButton(data, 'link-button')])]);
        card.insertBefore(hint, card.querySelector('.rcard__foot'));
      };

      card.appendChild(h('div', { class: 'rcard__foot' }, [viewSaveButton(data, 'link-button'), openOnX(data, 'link-quiet')]));
      loadSizes(collectSizeUrls(data));
      return card;
    }

    return { render: render, closeToast: closeToast, openLightbox: openLightbox };
  }

  var api = { createResultRenderer: createResultRenderer, buildPill: buildPill, mediaCounts: mediaCounts, sized: sized, primaryQualityLabel: primaryQualityLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPutResultCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
