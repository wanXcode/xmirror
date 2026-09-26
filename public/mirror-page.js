let translateStatusTimer;
let translationPollTimer;
let translationTaskId = null;
let manualThemeOverride = false;
let videoStatusTimer;
let subtitleStatusTimer;

function getSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  manualThemeOverride = true;
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function showContent(mode) {
  const origin = document.getElementById('originContent');
  const translated = document.getElementById('translatedContent');
  const isTranslated = mode === 'translated';
  translated.classList.toggle('active', isTranslated);
  origin.classList.toggle('active', !isTranslated);
  translated.setAttribute('aria-hidden', String(!isTranslated));
  origin.setAttribute('aria-hidden', String(isTranslated));
}

function detectOriginLang() {
  const text = (document.getElementById('originContent')?.textContent || '').trim();
  if (!text) return 'en';
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) return 'ko';
  const zhChars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (!zhChars) return 'en';
  if (!latinChars) return 'zh';
  return zhChars / (zhChars + latinChars) >= 0.2 ? 'zh' : 'en';
}

function getTranslateConfig() {
  const sourceLangFromServer = document.querySelector('.post')?.dataset?.sourceLang;
  const originLang = ['zh', 'en', 'ja', 'ko'].includes(sourceLangFromServer)
    ? sourceLangFromServer
    : detectOriginLang();
  const targetLang = originLang === 'zh' ? 'en' : 'zh-CN';
  return { originLang, targetLang, targetLabel: targetLang === 'en' ? '英文' : '中文' };
}

function setDefaultTranslateButtonText() {
  const btn = document.getElementById('translateBtn');
  if (btn) btn.textContent = `翻译为${getTranslateConfig().targetLabel}`;
}

function setTranslateStatus(message, { error = false, temporary = false } = {}) {
  const status = document.getElementById('translateStatus');
  clearTimeout(translateStatusTimer);
  status.classList.remove('is-error', 'is-fading');
  status.textContent = message;
  if (error) status.classList.add('is-error');
  if (temporary && message) {
    translateStatusTimer = setTimeout(() => {
      status.classList.add('is-fading');
      setTimeout(() => {
        status.textContent = '';
        status.classList.remove('is-fading');
      }, 200);
    }, 2500);
  }
}

function friendlyTranslateError(status) {
  if (status === 429) return '请求较多，请稍后再试';
  if (status === 404) return '这条存档已不存在';
  if (status === 400) return '当前内容无法翻译';
  if ([502, 503, 504].includes(status)) return '翻译服务暂时不可用，请稍后重试';
  return '翻译失败，请稍后重试';
}

function escapeTranslatedText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Work on text nodes only: existing links, media and code remain intact.
function linkifyContent(root) {
  if (!root || typeof document.createTreeWalker !== 'function') return;
  const walker = document.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('a, script, style, textarea, code, pre')) continue;
    const text = node.nodeValue;
    const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"'\u3000-\u303f\uff00-\uffef]+/gi;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      let label = match[0].replace(/[.,;:!?]+$/, '');
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        while (label.endsWith(close) && label.split(close).length > label.split(open).length) {
          label = label.slice(0, -1);
        }
      }
      let url;
      try { url = new URL(/^www\./i.test(label) ? `https://${label}` : label); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) continue;
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.appendChild(link);
      cursor = match.index + label.length;
    }
    if (!cursor) continue;
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
  }
}

function renderTranslatedBlocks(data) {
  const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']);
  const blocks = Array.isArray(data.blocks)
    ? data.blocks
    : (data.parts || []).map(text => ({ type: 'p', text }));
  return blocks.map(block => {
    const type = allowed.has(block.type) ? block.type : 'p';
    return `<${type}>${escapeTranslatedText(block.text)}</${type}>`;
  }).join('');
}

function renderTranslationTask(task) {
  const blocks = Array.isArray(task?.blocks) ? task.blocks : [];
  return blocks.map(block => {
    const type = allowedTranslationTypes.has(block.type) ? block.type : 'p';
    const text = escapeTranslatedText(block.text || block.sourceText || '');
    const pending = block.status !== 'completed';
    return `<${type}>${text}${pending ? ' <span class="translation-pending" aria-label="待翻译">· 待翻译</span>' : ''}</${type}>`;
  }).join('');
}

const allowedTranslationTypes = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']);

function translationTaskMessage(task) {
  if (!task) return '正在准备翻译…';
  if (task.status === 'completed') return '翻译完成';
  if (task.status === 'partial_failed' || task.failed) {
    return `已翻译 ${task.completed} / ${task.total} 段，${task.failed} 段未完成`;
  }
  if (task.status === 'queued') return `正在排队，已翻译 ${task.completed} / ${task.total} 段`;
  return `已翻译 ${task.completed} / ${task.total} 段`;
}

function saveTranslationTask(taskId, targetLang) {
  const postId = document.querySelector('.post')?.dataset?.postId;
  try { sessionStorage.setItem('xput-translation-task', JSON.stringify({ taskId, targetLang, postId })); } catch {}
}

function clearTranslationTask() {
  try { sessionStorage.removeItem('xput-translation-task'); } catch {}
}

function stopTranslationPolling() {
  if (translationPollTimer) clearTimeout(translationPollTimer);
  translationPollTimer = null;
}

async function fetchTranslationTask(taskId) {
  const res = await fetch(`/api/translate/tasks/${encodeURIComponent(taskId)}`, { headers: { Accept: 'application/json' } });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || !data.success) throw Object.assign(new Error('translation status failed'), { httpStatus: res.status, code: data.code });
  return data.task;
}

function updateTranslationView(task, cfg) {
  const btn = document.getElementById('translateBtn');
  const translatedEl = document.getElementById('translatedContent');
  if (!task || !btn || !translatedEl) return;
  translatedEl.innerHTML = renderTranslationTask(task) || '<p>暂无译文</p>';
  linkifyContent(translatedEl);
  showContent('translated');
  btn.disabled = false;
  btn.classList.remove('is-loading');
  btn.setAttribute('aria-busy', 'false');
  btn.textContent = '查看原文';
  setTranslateStatus(translationTaskMessage(task), { error: task.status === 'partial_failed' || task.failed });
  let retry = document.getElementById('translationRetry');
  if (task.status === 'partial_failed' || task.status === 'failed') {
    if (!retry) {
      retry = document.createElement('button');
      retry.id = 'translationRetry';
      retry.type = 'button';
      retry.className = 'translate-retry';
      retry.addEventListener('click', retryTranslation);
      document.getElementById('translateStatus')?.after(retry);
    }
    retry.textContent = '重试未完成部分';
    retry.hidden = false;
  } else if (retry) {
    retry.hidden = true;
  }
  if (task.status === 'completed' || task.status === 'partial_failed' || task.status === 'failed') {
    stopTranslationPolling();
    if (task.status === 'completed') clearTranslationTask();
  }
}

async function pollTranslationTask(taskId, cfg) {
  try {
    const task = await fetchTranslationTask(taskId);
    updateTranslationView(task, cfg);
    if (!['completed', 'partial_failed', 'failed'].includes(task.status)) {
      translationPollTimer = setTimeout(() => pollTranslationTask(taskId, cfg), document.hidden ? 6000 : 2500);
    }
    return task;
  } catch (error) {
    setTranslateStatus('翻译进度暂时无法读取，请稍后重试', { error: true });
    translationPollTimer = setTimeout(() => pollTranslationTask(taskId, cfg), 5000);
    return null;
  }
}

function formatVideoBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function buildVideoPlayerMarkup(video, postId) {
  return `<div class="video-shell" data-video-post-id="${encodeURIComponent(postId)}">
    <video controls style="max-width:100%;margin:10px 0;"><source src="${video}" type="video/mp4"></video>
    <div class="subtitle-toolbar" role="group" aria-label="字幕设置">
      <label for="subtitleSelect">CC 字幕</label>
      <select id="subtitleSelect" class="subtitle-select">
        <option value="" selected>关闭字幕</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
      <span id="subtitleStatus" class="subtitle-status" role="status" aria-live="polite"></span>
    </div>
  </div>`;
}

function subtitleLabel(lang, track) {
  const base = lang === 'zh-CN' ? '简体中文' : 'English';
  if (track.status === 'transcribing') return `${base}（识别中 ${track.progress || 0}%）`;
  if (track.status === 'translating') return `${base}（翻译中 ${track.progress || 0}%）`;
  if (track.status === 'queued') return `${base}（排队中）`;
  if (track.status === 'failed') return `${base}（失败，重试）`;
  return base;
}

function setSubtitleStatus(message, { error = false } = {}) {
  const status = document.getElementById('subtitleStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function applySubtitleTrack(lang, src) {
  const shell = document.querySelector('.video-shell');
  const video = shell?.querySelector?.('video');
  if (!video) return;
  Array.from(video.querySelectorAll('track')).forEach(track => {
    if (track.track) track.track.mode = 'disabled';
    track.remove();
  });
  if (!lang || !src || !/^\/subtitles\/[A-Za-z0-9_.-]+\.vtt$/.test(src)) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.src = src;
  track.srclang = lang;
  track.label = lang === 'zh-CN' ? '简体中文' : 'English';
  track.default = true;
  video.appendChild(track);
  track.addEventListener('load', () => { if (track.track) track.track.mode = 'showing'; }, { once: true });
}

function updateSubtitleOptions(data) {
  const select = document.getElementById('subtitleSelect');
  if (!select) return data?.tracks || {};
  const tracks = data?.tracks || {};
  for (const lang of ['en', 'zh-CN']) {
    const option = select.querySelector(`option[value="${lang}"]`);
    if (!option) continue;
    const track = tracks[lang] || { status: 'none' };
    option.textContent = subtitleLabel(lang, track);
    option.disabled = ['queued', 'transcribing', 'translating'].includes(track.status);
  }
  const selected = select.value;
  const selectedTrack = tracks[selected];
  if (selectedTrack?.status === 'completed') {
    applySubtitleTrack(selected, selectedTrack.src);
    setSubtitleStatus('字幕已就绪');
  } else if (selectedTrack?.status === 'failed') {
    setSubtitleStatus(selectedTrack.error || '字幕生成失败，重新选择即可重试', { error: true });
  }
  return tracks;
}

async function refreshSubtitleTracks() {
  const shell = document.querySelector('.video-shell');
  const postId = shell?.dataset?.videoPostId || document.querySelector('.post')?.dataset?.postId;
  if (!postId) return {};
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/subtitles`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '读取字幕状态失败');
    return updateSubtitleOptions(data);
  } catch (error) {
    setSubtitleStatus('字幕状态暂时无法读取', { error: true });
    return {};
  }
}

function startSubtitlePolling(postId, lang) {
  if (subtitleStatusTimer) clearInterval(subtitleStatusTimer);
  subtitleStatusTimer = setInterval(async () => {
    const tracks = await refreshSubtitleTracks();
    const track = tracks[lang];
    if (track?.status === 'completed' || track?.status === 'failed') {
      clearInterval(subtitleStatusTimer);
      subtitleStatusTimer = null;
      const select = document.getElementById('subtitleSelect');
      if (select) select.disabled = false;
    }
  }, 2500);
}

async function selectSubtitleLanguage(event) {
  const select = event.currentTarget;
  const lang = select.value;
  const shell = document.querySelector('.video-shell');
  const postId = shell?.dataset?.videoPostId || document.querySelector('.post')?.dataset?.postId;
  if (!postId) return;
  if (!lang) {
    applySubtitleTrack('', '');
    setSubtitleStatus('');
    return;
  }
  const tracks = await refreshSubtitleTracks();
  const track = tracks[lang];
  if (track?.status === 'completed') {
    applySubtitleTrack(lang, track.src);
    setSubtitleStatus('字幕已启用');
    return;
  }
  select.disabled = true;
  setSubtitleStatus(lang === 'zh-CN' ? '正在生成中文字幕…' : '正在生成英文字幕…');
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/subtitles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lang })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '字幕任务创建失败');
    startSubtitlePolling(postId, lang);
  } catch (error) {
    select.disabled = false;
    setSubtitleStatus(error.message || '字幕生成失败', { error: true });
  }
}

function initializeSubtitleControls() {
  const select = document.getElementById('subtitleSelect');
  if (!select || select.dataset.initialized === 'true') return;
  select.dataset.initialized = 'true';
  select.addEventListener('change', selectSubtitleLanguage);
  refreshSubtitleTracks();
}

function renderVideoPlaceholder(data) {
  const placeholder = document.querySelector('.video-placeholder');
  if (!placeholder) return false;
  const status = data.status || 'queued';
  const percent = Math.max(0, Math.min(100, Number(data.percent) || 0));
  if (status === 'completed' && typeof data.video === 'string' && /^\/videos\/[A-Za-z0-9_.-]+$/.test(data.video)) {
    const postId = document.querySelector('.post')?.dataset?.postId || '';
    placeholder.outerHTML = buildVideoPlayerMarkup(data.video, postId);
    initializeSubtitleControls();
    return true;
  }
  const title = placeholder.querySelector?.('.video-placeholder-title');
  const bar = placeholder.querySelector?.('.video-progress-bar');
  const text = placeholder.querySelector?.('.video-progress-text');
  if (status === 'failed') {
    placeholder.classList.add('video-placeholder-error');
    if (title) title.textContent = '视频下载失败';
    if (text) text.textContent = data.error || '请稍后重新收录';
    return true;
  }
  placeholder.dataset.videoStatus = status;
  if (title) title.textContent = status === 'downloading' ? '🎞️ 视频正在下载中…' : '🎞️ 视频即将开始下载…';
  if (bar) bar.style.width = `${percent}%`;
  if (text) text.textContent = percent > 0
    ? `${percent}% · ${formatVideoBytes(data.bytes)}${data.total ? ` / ${formatVideoBytes(data.total)}` : ''}`
    : '正在准备下载';
  if (status === 'completed') {
    placeholder.classList.add('video-placeholder-error');
    if (title) title.textContent = '视频地址异常';
    if (text) text.textContent = '视频文件尚未准备好，请稍后重试';
    return true;
  }
  return false;
}

async function pollVideoStatus() {
  const post = document.querySelector('.post');
  const placeholder = document.querySelector('.video-placeholder');
  const postId = post?.dataset?.postId;
  if (!postId || !placeholder) return false;
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/video-status`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '读取视频状态失败');
    return renderVideoPlaceholder(data);
  } catch (error) {
    const text = placeholder.querySelector?.('.video-progress-text');
    if (text) text.textContent = '正在连接下载状态…';
    return false;
  }
}

function initializeVideoDownload() {
  if (!document.querySelector('.video-placeholder')) return;
  if (videoStatusTimer) clearInterval(videoStatusTimer);
  pollVideoStatus().then(done => {
    if (!done) videoStatusTimer = setInterval(async () => {
      const finished = await pollVideoStatus();
      if (finished && videoStatusTimer) {
        clearInterval(videoStatusTimer);
        videoStatusTimer = null;
      }
    }, 2500);
  });
}

async function toggleTranslate() {
  const postId = document.querySelector('.post')?.dataset?.postId;
  const btn = document.getElementById('translateBtn');
  const translatedEl = document.getElementById('translatedContent');
  const cfg = getTranslateConfig();
  const hasTranslated = translatedEl.innerHTML.trim().length > 0;
  const showingTranslated = translatedEl.classList.contains('active');
  if (!postId || btn.disabled) return;

  if (hasTranslated) {
    if (showingTranslated) {
      showContent('origin');
      btn.textContent = `查看${cfg.targetLabel}译文`;
    } else {
      showContent('translated');
      btn.textContent = '查看原文';
    }
    setTranslateStatus('');
    return;
  }

  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = '准备翻译…';
  setTranslateStatus('正在准备翻译…');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`/api/translate/${postId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ targetLang: cfg.targetLang }),
      signal: controller.signal,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || !data.success) {
      throw Object.assign(new Error('translate failed'), { httpStatus: res.status, code: data.code });
    }
    // Keep the old endpoint usable for cached pages and older deployments during rollout.
    if (!data.task) {
      const legacy = await fetch(`/api/translate/${postId}?targetLang=${encodeURIComponent(cfg.targetLang)}`, { headers: { Accept: 'application/json' } });
      const legacyData = await legacy.json();
      if (!legacy.ok || !legacyData.success) throw Object.assign(new Error('translate failed'), { httpStatus: legacy.status });
      translatedEl.innerHTML = renderTranslatedBlocks(legacyData) || '<p>暂无译文</p>';
      linkifyContent(translatedEl);
      showContent('translated');
      btn.textContent = '查看原文';
      setTranslateStatus(legacyData.cached ? '已显示缓存译文' : '翻译完成', { temporary: true });
      return;
    }
    const task = data.task;
    translationTaskId = task.id;
    saveTranslationTask(task.id, cfg.targetLang);
    updateTranslationView(task, cfg);
    if (!['completed', 'partial_failed', 'failed'].includes(task.status)) {
      await pollTranslationTask(task.id, cfg);
    }
  } catch (error) {
    btn.textContent = '重试翻译';
    if (error.name === 'AbortError') setTranslateStatus('请求超时，请重试', { error: true });
    else if (error.code === 'TRANSLATION_LIMIT') setTranslateStatus('文章超过翻译上限', { error: true });
    else setTranslateStatus(friendlyTranslateError(error.httpStatus), { error: true });
  } finally {
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.setAttribute('aria-busy', 'false');
  }
}

async function retryTranslation() {
  if (!translationTaskId) return toggleTranslate();
  const cfg = getTranslateConfig();
  try {
    const res = await fetch(`/api/translate/tasks/${encodeURIComponent(translationTaskId)}/retry`, {
      method: 'POST', headers: { Accept: 'application/json' }
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error('retry failed');
    updateTranslationView(data.task, cfg);
    await pollTranslationTask(translationTaskId, cfg);
  } catch {
    setTranslateStatus('重试未完成部分失败，请稍后再试', { error: true });
  }
}

async function resumeTranslationTask() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('xput-translation-task') || 'null'); } catch { saved = null; }
  const currentPostId = document.querySelector('.post')?.dataset?.postId;
  if (!saved?.taskId || (saved.postId && saved.postId !== currentPostId)) return;
  translationTaskId = saved.taskId;
  const cfg = getTranslateConfig();
  try {
    const task = await fetchTranslationTask(saved.taskId);
    updateTranslationView(task, cfg);
    if (!['completed', 'partial_failed', 'failed'].includes(task.status)) pollTranslationTask(saved.taskId, cfg);
  } catch { clearTranslationTask(); }
}

function initializeMirrorPage() {
  linkifyContent(document.getElementById('originContent'));
  // Discard the legacy persistent override so existing pages return to system theme.
  try { localStorage.removeItem('xmirror-theme'); } catch {}
  const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  applyTheme(getSystemTheme());
  colorScheme?.addEventListener?.('change', event => {
    if (!manualThemeOverride) applyTheme(event.matches ? 'dark' : 'light');
  });
  setDefaultTranslateButtonText();
  initializeVideoDownload();
  initializeSubtitleControls();
  resumeTranslationTask();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMirrorPage, { once: true });
  } else {
    initializeMirrorPage();
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    getSystemTheme,
    toggleTheme,
    showContent,
    detectOriginLang,
    getTranslateConfig,
    setTranslateStatus,
    escapeTranslatedText,
    renderTranslatedBlocks,
    formatVideoBytes,
    buildVideoPlayerMarkup,
    subtitleLabel,
    applySubtitleTrack,
    updateSubtitleOptions,
    refreshSubtitleTracks,
    selectSubtitleLanguage,
    initializeSubtitleControls,
    renderVideoPlaceholder,
    pollVideoStatus,
    initializeVideoDownload,
    toggleTranslate,
    retryTranslation,
    renderTranslationTask,
    translationTaskMessage,
    resumeTranslationTask,
    initializeMirrorPage
  };
}
