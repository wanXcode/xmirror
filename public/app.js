let clickCounts = new Map();
let deleteTargetId = null;

async function archive() {
  const url = document.getElementById('url').value.trim();
  const result = document.getElementById('result');
  const loading = document.getElementById('loading');
  const btn = document.getElementById('submit');
  
  if (!url) {
    result.className = 'result error';
    result.innerHTML = i18n.t('errorEmptyUrl');
    return;
  }
  
  btn.disabled = true;
  loading.className = 'loading show';
  result.className = 'result';
  result.innerHTML = '';
  
  try {
    const response = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    
    const data = await response.json();
    
    if (data.success) {
      result.className = 'result success';
      result.innerHTML = `
        <strong>✅ ${data.message}</strong><br><br>
        ${i18n.t('mirrorLink')}：<a href="${data.url}" target="_blank">${window.location.origin}${data.url}</a>
      `;
      document.getElementById('url').value = '';
      loadHistory();
    } else {
      result.className = 'result error';
      result.innerHTML = `<strong>❌ ${i18n.t('errorArchive')}</strong><br>${data.error || 'Unknown error'}`;
    }
  } catch (error) {
    result.className = 'result error';
    result.innerHTML = `<strong>❌ ${i18n.t('errorRequest')}</strong><br>${error.message}`;
  } finally {
    btn.disabled = false;
    loading.className = 'loading';
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
    document.getElementById('deleteModal').classList.add('show');
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
  deleteTargetId = null;
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  
  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTargetId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      const result = document.getElementById('result');
      result.className = 'result success';
      result.innerHTML = `<strong>${i18n.t('successDeleted')}</strong>`;
      loadHistory();
    } else {
      const result = document.getElementById('result');
      result.className = 'result error';
      result.innerHTML = `<strong>❌ ${i18n.t('errorDelete')}</strong><br>${data.error || 'Unknown error'}`;
    }
  } catch (error) {
    const result = document.getElementById('result');
    result.className = 'result error';
    result.innerHTML = `<strong>❌ ${i18n.t('errorDelete')}</strong><br>${error.message}`;
  }
  
  closeDeleteModal();
}

async function loadHistory() {
  try {
    const response = await fetch('/api/posts');
    const posts = await response.json();
    
    if (posts.length > 0) {
      document.getElementById('history').style.display = 'block';
      const historyList = document.getElementById('historyList');
      historyList.innerHTML = posts.slice(0, 10).map(post => {
        // 提取标题
        let title = '';
        const contentText = post.content || '';
        const h1Match = contentText.match(/<h1>(.+?)<\/h1>/);
        if (h1Match) {
          title = h1Match[1].replace(/【(.+?)】/, '$1');
        } else {
          title = contentText.replace(/<[^>]+>/g, '').substring(0, 50);
          if (contentText.replace(/<[^>]+>/g, '').length > 50) title += '...';
        }
        const shortUrl = post.short_url || `/archives/${post.html_file}`;
        return `
        <div class="history-item" data-id="${post.id}">
          <a href="${shortUrl}" target="_blank">${title || i18n.t('noTitle')}</a>
          <div class="meta" onclick="handleItemClick(${post.id}, this.parentElement)">${post.author || i18n.t('unknownUser')} · ${new Date(post.created_at).toLocaleString()}</div>
        </div>
      `}).join('');
    } else {
      document.getElementById('history').style.display = 'none';
    }
  } catch (error) {
    console.error('Load history failed:', error);
  }
}

// 页面加载时获取历史
loadHistory();

// 回车提交
document.getElementById('url').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') archive();
});

// 点击弹窗外部关闭
document.getElementById('deleteModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteModal();
});