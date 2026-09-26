const home = XPutHome;
const PAGE_SIZE = 10;
const REQUEST_TIMEOUT_MS = 120000;
let clickCounts = new Map();
let deleteTargetId = null;
let submitting = false;
let resultState = null;
let localRecords = readLocalRecords();
let activeHistory = localRecords.length ? 'local' : 'public';
let publicPosts = [];
let historyOffset = 0;
let historyHasMore = true;
let historyLoading = false;
let historyError = false;
let historyNeedsReset = true;
let historyGeneration = 0;
let historyController;
let historyObserver;

function readLocalRecords() {
  try { return home.readRecords(localStorage); } catch { return []; }
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function updateSubmitState() {
  const button = document.getElementById('submit');
  button.disabled = submitting;
  button.setAttribute('aria-busy', String(submitting));
  button.textContent = i18n.t(submitting ? 'btnGenerating' : 'btnGenerate');
  document.getElementById('url').readOnly = submitting;
  document.getElementById('loading').hidden = !submitting;
}

function renderResult() {
  const result = document.getElementById('result');
  result.hidden = !resultState;
  if (!resultState) { result.replaceChildren(); return; }
  const state = resultState;
  result.className = `result ${state.kind === 'error' ? 'error' : 'success'}`;
  if (state.kind === 'error') {
    result.innerHTML = `<strong>${escapeText(i18n.t(state.key))}</strong>`;
    if (state.retryable) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'text-button';
      retry.textContent = i18n.t('retry');
      retry.addEventListener('click', archive);
      result.appendChild(document.createElement('br'));
      result.appendChild(retry);
    }
    return;
  }
  if (state.kind === 'deleted') { result.textContent = i18n.t('successDeleted'); return; }
  const data = state.data;
  result.innerHTML = `<strong>${escapeText(i18n.t(data.cached ? 'successExisting' : 'successArchived'))}</strong>
    <p>${escapeText(i18n.t('mirrorLink'))}：<a href="${escapeText(data.url)}" target="_blank" rel="noopener noreferrer">${escapeText(window.location.origin + data.url)}</a></p>`;
  if (['queued', 'downloading', 'failed'].includes(data.video_status)) {
    const video = document.createElement('p');
    video.textContent = i18n.t(data.video_status === 'failed' ? 'videoFailed' : 'videoPending');
    result.appendChild(video);
  }
  if (!state.saved) {
    const warning = document.createElement('p');
    warning.className = 'storage-note';
    warning.textContent = i18n.t('storageUnavailable');
    result.appendChild(warning);
  }
}

async function archive() {
  if (submitting) return;
  const input = document.getElementById('url');
  const url = input.value.trim();
  if (!home.validSourceUrl(url)) {
    resultState = { kind: 'error', key: url ? 'errorInvalidUrl' : 'errorEmptyUrl', retryable: false };
    input.setAttribute('aria-invalid', 'true');
    renderResult();
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  submitting = true;
  resultState = null;
  updateSubmitState();
  renderResult();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url }), signal: controller.signal
    });
    let data;
    try { data = await response.json(); }
    catch (error) { if (error.name === 'AbortError') throw error; }
    if (!response.ok || !data?.success) {
      throw Object.assign(new Error('archive failed'), { failure: home.failureFor(data?.code, response.status) });
    }
    if (!home.validMirrorPath(data.url) || !Number.isSafeInteger(data.id) || data.id <= 0) {
      throw Object.assign(new Error('invalid archive response'), { failure: home.failureFor('SERVICE_UNAVAILABLE') });
    }
    const record = {
      id: data.id, title: data.title || '', author: data.author || '', source_url: url,
      url: data.url, generated_at: new Date().toISOString()
    };
    let stored;
    try { stored = home.saveRecord(localStorage, record); }
    catch { stored = { saved: false }; }
    localRecords = stored.saved ? stored.records : home.normalizeRecords([record, ...localRecords.filter(item => item.id !== record.id)]);
    resultState = { kind: 'success', data, saved: stored.saved };
    input.value = '';
    invalidatePublicHistory();
    switchHistory('local');
  } catch (error) {
    const failure = error.failure || home.failureFor(error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    resultState = { kind: 'error', ...failure };
  } finally {
    clearTimeout(timer);
    submitting = false;
    updateSubmitState();
    renderResult();
  }
}

// 处理历史记录点击
function handleItemClick(postId, element) {
  const count = (clickCounts.get(postId) || 0) + 1;
  clickCounts.set(postId, count);
  
  // 显示点击提示
  element.classList.add('show-hint');
  const hint = element.querySelector('.click-hint');
  if (hint) {
    hint.textContent = i18n.t('clickHint', 4 - count);
  }
  
  // 视觉反馈
  if (count >= 2) {
    element.classList.add('triple-click');
  }
  
  // 3次点击触发删除弹窗
  if (count >= 3) {
    deleteTargetId = postId;
    const passwordInput = document.getElementById('deletePassword');
    const passwordError = document.getElementById('deletePasswordError');
    if (passwordInput) passwordInput.value = '';
    if (passwordError) passwordError.textContent = '';
    document.getElementById('deleteModal').classList.add('show');
    setTimeout(() => passwordInput?.focus(), 0);
    // 重置计数
    clickCounts.set(postId, 0);
    element.classList.remove('triple-click', 'show-hint');
  }
  
  // 2秒后重置计数
  setTimeout(() => {
    clickCounts.set(postId, 0);
    element.classList.remove('triple-click', 'show-hint');
  }, 2000);
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('show');
  const passwordInput = document.getElementById('deletePassword');
  const passwordError = document.getElementById('deletePasswordError');
  if (passwordInput) passwordInput.value = '';
  if (passwordError) passwordError.textContent = '';
  deleteTargetId = null;
}

async function confirmDelete() {
  if (!deleteTargetId) return;

  const passwordInput = document.getElementById('deletePassword');
  const passwordError = document.getElementById('deletePasswordError');
  const deleteButton = document.querySelector('.btn-delete');
  const password = passwordInput?.value || '';

  if (!password) {
    if (passwordError) passwordError.textContent = i18n.t('deletePasswordRequired');
    passwordInput?.focus();
    return;
  }

  if (passwordError) passwordError.textContent = '';
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.setAttribute('aria-busy', 'true');
  }
  
  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': password
      },
      body: JSON.stringify({ id: deleteTargetId })
    });
    if (passwordInput) passwordInput.value = '';
    
    const data = await response.json();
    
    if (data.success) {
      resultState = { kind: 'deleted' };
      renderResult();
      localRecords = localRecords.filter(record => record.id !== deleteTargetId);
      try { localStorage.setItem(home.STORAGE_KEY, JSON.stringify(localRecords)); } catch {}
      renderLocalHistory();
      invalidatePublicHistory();
      if (activeHistory === 'public') loadHistory(true);
      closeDeleteModal();
    } else if (response.status === 403) {
      if (passwordError) passwordError.textContent = i18n.t('deletePasswordInvalid');
      passwordInput?.focus();
    } else {
      if (passwordError) passwordError.textContent = i18n.t('errorDelete');
    }
  } catch (error) {
    if (passwordInput) passwordInput.value = '';
    if (passwordError) passwordError.textContent = i18n.t('errorDelete');
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.setAttribute('aria-busy', 'false');
    }
  }
}

function postTitle(post) {
  if (post.title) return post.title;
  const doc = new DOMParser().parseFromString(String(post.content || ''), 'text/html');
  const title = (doc.querySelector('h1') || doc.body).textContent.replace(/\s+/g, ' ').trim().replace(/^【(.+)】$/, '$1');
  return title.length > 80 ? `${title.slice(0, 80)}…` : title;
}

function renderHistoryItems(posts, local = false) {
  return posts.map(post => {
    const shortUrl = local ? post.url : post.short_url || `/archives/${post.html_file}`;
    if (!home.validMirrorPath(shortUrl) || !Number.isSafeInteger(post.id) || post.id <= 0) return '';
    const date = new Date(local ? post.generated_at : post.created_at);
    const time = Number.isFinite(date.getTime()) ? date.toLocaleString(i18n.currentLang === 'zh' ? 'zh-CN' : 'en', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';
    return `<article class="history-item" data-id="${post.id}">
      <a href="${escapeText(shortUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(postTitle(post) || i18n.t('noTitle'))}</a>
      <div class="meta"${local ? '' : ` onclick="handleItemClick(${post.id}, this.parentElement)"`}>${escapeText(post.author || i18n.t('unknownUser'))} · ${escapeText(time)}</div>
    </article>`;
  }).join('');
}

function renderLocalHistory() {
  document.getElementById('localHistoryList').innerHTML = localRecords.length
    ? renderHistoryItems(localRecords, true)
    : `<p class="empty-state">${escapeText(i18n.t('localHistoryEmpty'))}</p>`;
}

function renderPublicHistory() {
  document.getElementById('historyList').innerHTML = renderHistoryItems(publicPosts);
  const status = document.getElementById('historyLoading');
  const key = historyLoading ? 'historyLoadingMore' : historyError ? 'historyLoadError'
    : !historyHasMore ? (publicPosts.length ? 'historyNoMore' : 'publicHistoryEmpty') : null;
  status.hidden = !key;
  status.textContent = key ? i18n.t(key) : '';
  document.getElementById('historyRetry').hidden = !historyError || historyLoading;
  document.getElementById('historyMore').hidden = historyLoading || historyError || !historyHasMore;
}

function switchHistory(tab) {
  activeHistory = tab;
  for (const name of ['local', 'public']) {
    const selected = name === tab;
    document.getElementById(`${name}Tab`).setAttribute('aria-selected', String(selected));
    document.getElementById(`${name}Tab`).tabIndex = selected ? 0 : -1;
    document.getElementById(`${name}Panel`).hidden = !selected;
  }
  if (tab === 'local') renderLocalHistory();
  else if (historyNeedsReset && !historyLoading && !historyError) loadHistory(true);
}

function invalidatePublicHistory() {
  historyGeneration += 1;
  historyController?.abort();
  historyLoading = false;
  historyError = false;
  historyNeedsReset = true;
}

async function loadHistory(reset = false) {
  if (historyLoading) return;
  reset = reset || historyNeedsReset;
  if (!reset && !historyHasMore) return;
  const generation = ++historyGeneration;
  const offset = reset ? 0 : historyOffset;
  historyController = new AbortController();
  const controller = historyController;
  const timer = setTimeout(() => controller.abort(), 20000);
  historyLoading = true;
  historyError = false;
  renderPublicHistory();
  try {
    const response = await fetch(`/api/posts?limit=${PAGE_SIZE}&offset=${offset}`, { signal: controller.signal });
    if (!response.ok) throw new Error('history unavailable');
    const data = await response.json();
    if (!Array.isArray(data) && !Array.isArray(data?.posts)) throw new Error('invalid history response');
    const posts = Array.isArray(data) ? data.slice(offset, offset + PAGE_SIZE) : data.posts;
    if (generation !== historyGeneration) return;
    publicPosts = reset ? posts : [...publicPosts, ...posts];
    // Keep the server offset separate from de-duplication if new public posts arrive during paging.
    historyOffset = offset + posts.length;
    publicPosts = publicPosts.filter((post, index, all) => all.findIndex(item => item.id === post.id) === index);
    historyHasMore = posts.length > 0 && (Array.isArray(data) ? historyOffset < data.length : !!data.has_more);
    historyNeedsReset = false;
  } catch {
    if (generation === historyGeneration) historyError = true;
  } finally {
    clearTimeout(timer);
    if (generation === historyGeneration) {
      historyLoading = false;
      renderPublicHistory();
    }
  }
}

function updateHomeCopy() {
  updateSubmitState();
  renderResult();
  renderLocalHistory();
  renderPublicHistory();
}

let homeThemeOverride = false;
const homeColorScheme = window.matchMedia('(prefers-color-scheme: dark)');
function toggleHomeTheme() {
  homeThemeOverride = true;
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
}
document.documentElement.dataset.theme = homeColorScheme.matches ? 'dark' : 'light';
homeColorScheme.addEventListener('change', event => {
  if (!homeThemeOverride) document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
});

document.getElementById('archiveForm').addEventListener('submit', event => {
  event.preventDefault();
  archive();
});
document.getElementById('url').addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
document.querySelector('.history-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'local' : event.key === 'End' ? 'public' : activeHistory === 'local' ? 'public' : 'local';
  switchHistory(next);
  document.getElementById(`${next}Tab`).focus();
});
document.addEventListener('languagechange', updateHomeCopy);
window.addEventListener('storage', event => {
  if (event.key === home.STORAGE_KEY || event.key === null) {
    localRecords = readLocalRecords();
    renderLocalHistory();
  }
});
document.getElementById('deleteModal').addEventListener('click', event => {
  if (event.target === event.currentTarget) closeDeleteModal();
});
document.getElementById('deletePassword').addEventListener('keydown', event => {
  if (event.key === 'Enter') confirmDelete();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeDeleteModal();
});
if ('IntersectionObserver' in window) {
  historyObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && activeHistory === 'public' && !historyLoading && !historyError && historyHasMore) loadHistory();
  }, { rootMargin: '0px 0px 200px 0px' });
  historyObserver.observe(document.getElementById('historySentinel'));
}
switchHistory(activeHistory);
