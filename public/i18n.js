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
      btnGenerating: "正在生成…",
      localHistoryTab: "本机记录",
      publicHistoryTab: "最新公开存档",
      localHistoryEmpty: "本机记录仅保存在当前浏览器，之后生成的存档会显示在这里。",
      publicHistoryEmpty: "暂无公开存档。",
      historyLoadError: "存档列表暂时加载失败，",
      historyRetry: "请重试",
      retry: "重试",
      loadMore: "加载更多",
      successArchived: "存档成功",
      successExisting: "已找到存档",
      videoPending: "正文已保存，视频仍在下载。可打开链接查看进度。",
      videoFailed: "正文已保存，视频下载失败。请稍后重新提交原链接重试。",
      storageUnavailable: "存档已生成，但本次记录未能保存到浏览器。",
      errorInvalidUrl: "请输入有效的 X / Twitter 推文或文章链接。",
      errorSourceUnavailable: "暂时无法访问原文，请检查链接及原文访问权限。",
      errorContentUnsupported: "当前内容不支持存档。",
      errorNetwork: "网络连接异常，请检查网络后重试。",
      errorTimeout: "等待超时，存档结果尚未确认。请稍后重试，已完成的存档会直接返回。",
      errorService: "服务暂时不可用，请稍后重试。",
      themeToggle: "切换主题",
      pageSettings: "页面设置",
      archiveSection: "生成存档",
      historySection: "存档记录",
      heroTitle: 'X 内容存档与分享',
      title: 'XPut',
      subtitle: '保存 X 上的图文与视频，随时阅读，轻松分享。',
      shortcutTitle: 'iPhone 快捷指令，一键存档',
      shortcutDesc: '复制 X 链接后，一键生成 XPut 存档链接',
      shortcutInstall: '获取快捷指令 ↗',
      helpLink: '使用帮助',
      browseLink: '浏览公开存档 →',
      reportLink: '投诉／删除申请',
      footerSlogan: '存下来，慢慢读，分享出去。',
      labelUrl: 'X 链接',
      placeholderUrl: '粘贴 X / Twitter 帖子链接',
      btnGenerate: '存档',
      loadingText: '正在抓取内容...',
      historyTitle: '最新公开存档',
      historyLoadingMore: '正在努力加载',
      historyNoMore: '已经到底啦',
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
      deletePasswordLabel: '管理密码',
      deletePasswordPlaceholder: '输入管理密码',
      deletePasswordRequired: '请输入管理密码',
      deletePasswordInvalid: '密码不正确，请重试',
      btnCancel: '取消',
      btnDelete: '删除',
      
      // 结果信息
      mirrorLink: '镜像链接',
    },
    en: {
      btnGenerating: "Generating…",
      localHistoryTab: "On this device",
      publicHistoryTab: "Public archives",
      localHistoryEmpty: "Local records stay in this browser, and new archives will appear here.",
      publicHistoryEmpty: "No public archives yet.",
      historyLoadError: "Could not load archives.",
      historyRetry: "Please try again",
      retry: "Try again",
      loadMore: "Load more",
      successArchived: "Archive created",
      successExisting: "Archive found",
      videoPending: "Content saved. The video is still downloading. Open the link to check progress.",
      videoFailed: "Content saved, but the video download failed. Submit the original link again later to retry.",
      storageUnavailable: "Your archive is ready, but this browser could not save it to your history.",
      errorInvalidUrl: "Enter a valid X / Twitter post or article link.",
      errorSourceUnavailable: "The original post is unavailable. Check the link and access permissions.",
      errorContentUnsupported: "This content cannot be archived.",
      errorNetwork: "Connection problem. Check your network and try again.",
      errorTimeout: "The wait timed out; the archive result is not yet confirmed. Try again later to retrieve it if it completed.",
      errorService: "The service is temporarily unavailable. Please try again later.",
      themeToggle: "Switch theme",
      pageSettings: "Page settings",
      archiveSection: "Create archive",
      historySection: "Archive history",
      heroTitle: 'Archive and share X posts',
      title: 'XPut',
      subtitle: 'Save posts and videos from X, read anytime, share with ease.',
      shortcutTitle: 'iPhone Shortcut, one-tap archive',
      shortcutDesc: 'Copy an X link and create an XPut archive in one tap',
      shortcutInstall: 'Get shortcut ↗',
      helpLink: 'Help',
      browseLink: 'Browse →',
      reportLink: 'Report / removal',
      footerSlogan: 'Save it, read slowly, share it.',
      labelUrl: 'X Link',
      placeholderUrl: 'Paste an X / Twitter post link',
      btnGenerate: 'Archive',
      loadingText: 'Fetching content...',
      historyTitle: 'Latest public archives',
      historyLoadingMore: 'Loading more...',
      historyNoMore: 'You have reached the end',
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
      deletePasswordLabel: 'Admin password',
      deletePasswordPlaceholder: 'Enter admin password',
      deletePasswordRequired: 'Enter the admin password',
      deletePasswordInvalid: 'Incorrect password. Try again.',
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
      langBtn.textContent = this.currentLang === 'zh' ? 'EN' : '中文';
    }
  },

  // 更新页面文本
  updatePage() {
    // 更新标题
    const h1 = document.querySelector('.brand h1');
    if (h1) h1.textContent = this.t('title');
    
    // 更新副标题
    const subtitle = document.querySelector('.home-subtitle');
    if (subtitle) subtitle.textContent = this.t('subtitle');

    const heroTitle = document.querySelector('.hero-title h1');
    if (heroTitle) heroTitle.textContent = this.t('heroTitle');
    
    for (const [selector, key] of [
      ['.shortcut-copy .title', 'shortcutTitle'],
      ['.shortcut-copy .desc', 'shortcutDesc'],
      ['.shortcut-link', 'shortcutInstall'],
      ['.footer-slogan', 'footerSlogan']
    ]) {
      const element = document.querySelector(selector);
      if (element) element.textContent = this.t(key);
    }

    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      if (['helpLink', 'browseLink', 'reportLink'].includes(key)) element.textContent = this.t(key);
    });

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
    
    for (const [id, key] of [
      ['localTab', 'localHistoryTab'], ['publicTab', 'publicHistoryTab'],
      ['historyRetry', 'historyRetry'], ['historyMore', 'loadMore']
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = this.t(key);
    }
    for (const [selector, key] of [
      ['#themeButton', 'themeToggle'], ['.page-tools', 'pageSettings'],
      ['.archive-section', 'archiveSection'], ['.history', 'historySection'], ['.history-tabs', 'historySection']
    ]) {
      document.querySelector(selector)?.setAttribute('aria-label', this.t(key));
    }

    // 更新删除弹窗
    const modalTitle = document.querySelector('.modal h3');
    if (modalTitle) modalTitle.textContent = this.t('deleteTitle');
    
    const modalText = document.querySelector('.modal p');
    if (modalText) modalText.innerHTML = this.t('deleteConfirm');

    const passwordLabel = document.getElementById('deletePasswordLabel');
    if (passwordLabel) passwordLabel.textContent = this.t('deletePasswordLabel');

    const passwordInput = document.getElementById('deletePassword');
    if (passwordInput) passwordInput.placeholder = this.t('deletePasswordPlaceholder');
    
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
      ? 'XPut - X/Twitter 内容存档工具 | 保存推文、图片和视频'
      : 'XPut - X/Twitter Content Archiver | Save Tweets, Images & Videos';
    
    // 更新 description
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) {
      descMeta.content = isZh
        ? 'XPut 是一款专业的 X(Twitter) 内容存档工具，可保存推文、图片和视频，生成可访问的镜像页面。支持钉钉/微信卡片分享，防止内容丢失。'
        : 'XPut is a professional X(Twitter) content archiving tool that saves tweets, images, and videos, generating accessible mirror pages.';
    }
    
    // 更新 og:locale
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.content = isZh ? 'zh_CN' : 'en_US';
    
    // 更新 og:description
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      ogDesc.content = isZh
        ? '专业的 X(Twitter) 内容存档工具，保存推文、图片和视频，生成可访问的镜像页面。'
        : 'Professional X(Twitter) content archiving tool that saves tweets, images, and videos.';
    }
    
    // 更新 twitter:description
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) {
      twDesc.content = isZh
        ? '专业的 X(Twitter) 内容存档工具，保存推文、图片和视频。'
        : 'Professional X(Twitter) content archiving tool that saves tweets, images, and videos.';
    }
  },

  // 切换语言（手动）
  switchLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    this.updatePage();
    this.updateLangButton();
    document.dispatchEvent(new Event('languagechange'));
  }
};

// 切换语言函数（供按钮调用）
function toggleLanguage() {
  const newLang = i18n.currentLang === 'zh' ? 'en' : 'zh';
  i18n.switchLanguage(newLang);
}

// 页面加载时初始化
i18n.init();
