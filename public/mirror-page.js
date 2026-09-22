let translateStatusTimer;
let manualThemeOverride = false;
let videoStatusTimer;

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
  if (btn) btn.textContent = `🌐 翻译为${getTranslateConfig().targetLabel}`;
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

function formatVideoBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function renderVideoPlaceholder(data) {
  const placeholder = document.querySelector('.video-placeholder');
  if (!placeholder) return false;
  const status = data.status || 'queued';
  const percent = Math.max(0, Math.min(100, Number(data.percent) || 0));
  if (status === 'completed' && typeof data.video === 'string' && /^\/videos\/[A-Za-z0-9_.-]+$/.test(data.video)) {
    placeholder.outerHTML = `<video controls style="max-width:100%;margin:10px 0;"><source src="${data.video}" type="video/mp4"></video>`;
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
      btn.textContent = `🌐 查看${cfg.targetLabel}译文`;
    } else {
      showContent('translated');
      btn.textContent = '📝 查看原文';
    }
    setTranslateStatus('');
    return;
  }

  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = '正在翻译…';
  setTranslateStatus('正在翻译，请稍候');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`/api/translate/${postId}?targetLang=${encodeURIComponent(cfg.targetLang)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || !data.success) {
      throw Object.assign(new Error('translate failed'), { httpStatus: res.status });
    }
    translatedEl.innerHTML = renderTranslatedBlocks(data) || '<p>暂无译文</p>';
    showContent('translated');
    btn.textContent = '📝 查看原文';
    setTranslateStatus(data.cached ? '已显示缓存译文' : '翻译完成', { temporary: true });
  } catch (error) {
    btn.textContent = '↻ 重新翻译';
    if (error.name === 'AbortError') setTranslateStatus('请求超时，请重试', { error: true });
    else setTranslateStatus(friendlyTranslateError(error.httpStatus), { error: true });
  } finally {
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.setAttribute('aria-busy', 'false');
  }
}

function initializeMirrorPage() {
  // Discard the legacy persistent override so existing pages return to system theme.
  try { localStorage.removeItem('xmirror-theme'); } catch {}
  const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  applyTheme(getSystemTheme());
  colorScheme?.addEventListener?.('change', event => {
    if (!manualThemeOverride) applyTheme(event.matches ? 'dark' : 'light');
  });
  setDefaultTranslateButtonText();
  initializeVideoDownload();
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
    renderVideoPlaceholder,
    pollVideoStatus,
    initializeVideoDownload,
    toggleTranslate,
    initializeMirrorPage
  };
}
