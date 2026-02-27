// i18n 国际化配置
const i18n = {
  // 检测浏览器语言
  detectLanguage() {
    const lang = navigator.language || navigator.userLanguage;
    // 中文语言码：zh, zh-CN, zh-TW, zh-HK
    if (lang.startsWith('zh')) {
      return 'zh';
    }
    // 默认英文
    return 'en';
  },

  // 当前语言
  currentLang: 'zh',

  // 语言配置
  translations: {
    zh: {
      title: '🐦 XMirror',
      subtitle: '粘贴 X 链接，生成可访问的镜像页面',
      labelUrl: 'X 链接',
      placeholderUrl: 'https://x.com/username/status/1234567890',
      btnGenerate: '生成镜像',
      loadingText: '正在抓取内容...',
      historyTitle: '📚 最近存档',
      unknownUser: '未知用户',
      noTitle: '无标题',
      
      // 提示信息
      errorEmptyUrl: '请输入 X 链接',
      errorArchive: '失败',
      errorRequest: '请求失败',
      successDeleted: '✅ 已删除',
      errorDelete: '删除失败',
      clickHint: (count) => `再点击 ${count} 次删除`,
      
      // 删除弹窗
      deleteTitle: '🗑️ 确认删除',
      deleteConfirm: '确定要删除这篇存档吗？<br>此操作不可恢复。',
      btnCancel: '取消',
      btnDelete: '删除',
      
      // 结果信息
      mirrorLink: '镜像链接',
    },
    en: {
      title: '🐦 XMirror',
      subtitle: 'Paste X link to generate accessible mirror page',
      labelUrl: 'X Link',
      placeholderUrl: 'https://x.com/username/status/1234567890',
      btnGenerate: 'Generate Mirror',
      loadingText: 'Fetching content...',
      historyTitle: '📚 Recent Archives',
      unknownUser: 'Unknown User',
      noTitle: 'No Title',
      
      // Messages
      errorEmptyUrl: 'Please enter X link',
      errorArchive: 'Failed',
      errorRequest: 'Request failed',
      successDeleted: '✅ Deleted',
      errorDelete: 'Delete failed',
      clickHint: (count) => `Click ${count} more times to delete`,
      
      // Delete modal
      deleteTitle: '🗑️ Confirm Delete',
      deleteConfirm: 'Are you sure you want to delete this archive?<br>This action cannot be undone.',
      btnCancel: 'Cancel',
      btnDelete: 'Delete',
      
      // Result
      mirrorLink: 'Mirror Link',
    }
  },

  // 获取翻译文本
  t(key, ...args) {
    const text = this.translations[this.currentLang][key];
    if (typeof text === 'function') {
      return text(...args);
    }
    return text || key;
  },

  // 初始化
  init() {
    this.currentLang = this.detectLanguage();
    document.documentElement.lang = this.currentLang === 'zh' ? 'zh-CN' : 'en';
    this.updatePage();
    this.updateLangButton();
  },

  // 更新语言按钮显示
  updateLangButton() {
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) {
      langBtn.textContent = this.currentLang === 'zh' ? '🌐 EN' : '🌐 中文';
    }
  },

  // 更新页面文本
  updatePage() {
    // 更新标题
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = this.t('title');
    
    // 更新副标题
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.textContent = this.t('subtitle');
    
    // 更新标签
    const label = document.querySelector('.input-group label');
    if (label) label.textContent = this.t('labelUrl');
    
    // 更新输入框占位符
    const urlInput = document.getElementById('url');
    if (urlInput) urlInput.placeholder = this.t('placeholderUrl');
    
    // 更新按钮
    const submitBtn = document.getElementById('submit');
    if (submitBtn) submitBtn.textContent = this.t('btnGenerate');
    
    // 更新加载文本
    const loadingText = document.querySelector('.loading p');
    if (loadingText) loadingText.textContent = this.t('loadingText');
    
    // 更新历史标题
    const historyTitle = document.querySelector('.history h3');
    if (historyTitle) historyTitle.textContent = this.t('historyTitle');
    
    // 更新删除弹窗
    const modalTitle = document.querySelector('.modal h3');
    if (modalTitle) modalTitle.textContent = this.t('deleteTitle');
    
    const modalText = document.querySelector('.modal p');
    if (modalText) modalText.innerHTML = this.t('deleteConfirm');
    
    const cancelBtn = document.querySelector('.btn-cancel');
    if (cancelBtn) cancelBtn.textContent = this.t('btnCancel');
    
    const deleteBtn = document.querySelector('.btn-delete');
    if (deleteBtn) deleteBtn.textContent = this.t('btnDelete');
    
    // 更新 SEO meta
    this.updateSEO();
  },

  // 更新 SEO 标签
  updateSEO() {
    const isZh = this.currentLang === 'zh';
    
    // 更新 title
    document.title = isZh 
      ? 'XMirror - X/Twitter 内容存档工具 | 永久保存推文、图片和视频'
      : 'XMirror - X/Twitter Content Archiver | Save Tweets, Images & Videos';
    
    // 更新 description
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) {
      descMeta.content = isZh
        ? 'XMirror 是一款专业的 X(Twitter) 内容存档工具，可永久保存推文、图片和视频，生成可访问的镜像页面。支持钉钉/微信卡片分享，防止内容丢失。'
        : 'XMirror is a professional X(Twitter) content archiving tool that permanently saves tweets, images, and videos, generating accessible mirror pages.';
    }
    
    // 更新 keywords
    const keywordsMeta = document.querySelector('meta[name="keywords"]');
    if (keywordsMeta) {
      keywordsMeta.content = isZh
        ? 'X存档,Twitter存档,推文备份,内容镜像,X内容保存,Twitter备份工具,推文存档,社交媒体备份'
        : 'X archive,Twitter archive,tweet backup,content mirror,X content save,Twitter backup tool,tweet archive,social media backup';
    }
    
    // 更新 og:locale
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.content = isZh ? 'zh_CN' : 'en_US';
    
    // 更新 og:description
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      ogDesc.content = isZh
        ? '专业的 X(Twitter) 内容存档工具，永久保存推文、图片和视频，生成可访问的镜像页面。'
        : 'Professional X(Twitter) content archiving tool that permanently saves tweets, images, and videos.';
    }
    
    // 更新 twitter:description
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) {
      twDesc.content = isZh
        ? '专业的 X(Twitter) 内容存档工具，永久保存推文、图片和视频。'
        : 'Professional X(Twitter) content archiving tool that permanently saves tweets, images, and videos.';
    }
  },

  // 切换语言（手动）
  switchLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    this.updatePage();
    this.updateLangButton();
  }
};

// 切换语言函数（供按钮调用）
function toggleLanguage() {
  const newLang = i18n.currentLang === 'zh' ? 'en' : 'zh';
  i18n.switchLanguage(newLang);
}

// 页面加载时初始化
i18n.init();