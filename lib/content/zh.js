// 中文界面文案与页面文案。键结构必须与 en.js 保持一致（测试会检查）。
// 页面文案来自设计画板（W_HomeZH / W_ViewerZH）；设计稿没有的状态文案（input.*）为开发草拟，待确认。
module.exports = {
  ui: {
    skipToContent: '跳到正文',
    menu: '菜单',
    closeMenu: '关闭菜单',
    mainNav: '主导航',
    language: '语言',
    comingSoon: '即将推出'
  },
  nav: {
    downloader: '视频下载',
    viewer: '推特查看器',
    shortcut: 'iPhone 快捷指令'
  },
  footer: {
    browse: '值得再读',
    tagline: '干净的 X 视频下载器与查看器。无弹窗，无跳转。',
    notAffiliated: '与 X Corp. 无关联。',
    privacy: '隐私政策',
    report: '举报内容'
  },

  input: {
    label: 'X 帖子链接',
    placeholder: '粘贴 X 帖子链接',
    paste: '粘贴',
    download: '下载',
    view: '查看',
    viewPost: '查看帖子',
    fetching: '获取中…',
    saving: '保存中…',
    clipboardFound: '剪贴板里有一个链接 —',
    clipboardFill: '点击填入',
    pasteFailed: '长按输入框即可粘贴',
    errEmpty: '请先粘贴 X 帖子链接。',
    errInvalid: '这不是 X 帖子链接。链接应类似 x.com/用户名/status/123…',
    errNotSingle: '请粘贴单条帖子的链接，而不是个人主页。',
    loadingNote: '正在从 X 获取帖子，通常只需几秒。',
    unavailable: {
      title: '该帖子无法查看',
      text: '它可能已被删除，或来自私密或已被封禁的账号。',
      textNoCopy: '我们没有这条帖子的已保存副本。',
      check: '查找已保存的副本',
      another: '换一个链接'
    },
    rejected: {
      title: '无法显示这条帖子',
      text: '它不符合 XPut 的内容规则。',
      another: '换一个链接'
    },
    busy: {
      title: 'XPut 现在有点忙',
      text: '没能及时连接到 X。你的链接没有问题，请再试一次。',
      retry: '重试'
    },
    tooMany: {
      title: '请求太频繁',
      text: '你在短时间内发起了太多请求，请稍等片刻。',
      retryIn: '{time} 后可重试',
      retry: '重试'
    },
    sensitive: {
      title: '敏感内容',
      textDownload: '该帖子在 X 上被标记为敏感内容。请确认你已年满 18 岁，以查看并获取下载链接。',
      textView: '该帖子在 X 上被标记为敏感内容。请确认你已年满 18 岁，以查看内容。',
      confirm: '我已年满 18 岁，显示内容',
      back: '返回'
    },
    saved: {
      title: '正在保存副本…',
      note: '即使原帖被删除，你的链接仍然有效。',
      already: '已于 {date} 保存',
      opening: '正在打开已保存的副本…'
    }
  },

  // 结果卡、下载反馈与手机保存提示。设计稿只有英文，中文为开发草拟，待确认。
  result: {
    pillVideo: '视频',
    pillVideos: '{n} 个视频',
    pillVideoCount: '{n} 个视频',
    pillGif: 'GIF',
    pillGifs: '{n} 个 GIF',
    pillPhoto: '1 张图片',
    pillPhotos: '{n} 张图片',
    pillQuotedVideo: '引用帖视频',
    pillQuotedGif: '引用帖 GIF',
    pillQuotedPhotos: '引用帖图片',
    pillQuotedMedia: '引用帖媒体',
    labelPhoto: '1 张图片 · 原图尺寸',
    labelPhotos: '{n} 张图片 · 原图尺寸',
    gifLoops: 'GIF · 循环播放',
    play: '播放预览',
    downloadHd: '下载高清 {quality}',
    downloadQuality: '下载 {quality}',
    infoVideo: '视频 · {quality} · {size}',
    infoVideoNoSize: '视频 · {quality}',
    infoGif: 'GIF · {size}',
    infoGifNoSize: 'GIF',
    rowVideo: '视频',
    rowGif: 'GIF',
    rowGifSaved: '保存为 MP4',
    rowPhoto: '1 张图片',
    rowPhotos: '{n} 张图片',
    rowPhotosNote: '原图尺寸',
    selectedCount: '已选 {n} 张',
    zipShort: '下载 {n} 张（ZIP）',
    saveToPhotosShort: '保存 {n} 张到相册',
    gifButtonShort: '下载 GIF',
    qualityMp4: '{quality} · MP4',
    otherQualities: '其他清晰度',
    variantDownload: '下载',
    variantDownloadSize: '下载 · {size}',
    downloading: '下载中…',
    downloadingPercent: '下载中… {percent}%',
    saved: '已保存',
    failed: '下载失败，点按重试',
    retryIn: '{time} 后可重试',
    photosHint: '点按图片可全屏查看，点按圆圈可选择。',
    openPhoto: '全屏查看第 {n} 张图片',
    selectPhoto: '选择第 {n} 张图片',
    zip: '下载 {n} 张图片（ZIP）',
    zipOne: '下载图片',
    saveToPhotos: '保存 {n} 张图片到相册',
    saveOneToPhotos: '保存图片到相册',
    selectSome: '请选择要下载的图片',
    originalSize: '原图尺寸',
    gifButton: '下载 GIF（MP4）',
    gifNote: 'X 把 GIF 存成循环播放的短视频，所以会保存为 MP4。在微信、WhatsApp 和 Telegram 中发送时，它仍会像动图一样播放。',
    viewSave: '查看并保存副本',
    openOnX: '在 X 打开',
    copyText: '复制文字',
    copied: '已复制',
    noMedia: '这条帖子没有可下载的视频、GIF 或图片。',
    fromQuoted: '来自被引用的帖子 · @{handle}',
    lastHint: '想让这个链接长期有效？',
    lightboxCounter: '{index} / {total}',
    lightboxLabel: '图片全屏查看',
    saveThisPhoto: '保存这张图片',
    pressHold: '也可以长按图片来保存',
    close: '关闭',
    previous: '上一张',
    next: '下一张',
    dismiss: '关闭提示',
    tipIosTitle: '已保存到「文件」',
    tipIosText: '打开「文件」→「下载」，点「分享」→「存储视频」即可存到相册。',
    tipIosLink: '获取一键快捷指令 →',
    tipAndroidTitle: '已保存到「下载」',
    tipAndroidText: '你也可以在相册中找到它。'
  },

  // 已保存帖子页 /{shortCode}：普通版与精选版（W_CopyZH_M、W_FeaturedZH）。画板没有的文案为开发草拟，待确认。
  post: {
    h1Suffix: '的 X 帖子',
    copyLink: '复制链接',
    shareLink: '分享链接',
    linkCopied: '链接已复制',
    linkCopiedToast: '链接已复制，可以粘贴到任何地方分享',
    downloadMedia: '下载媒体',
    openOnX: '在 X 打开',
    translate: '翻译帖子',
    translateShowOriginal: '显示原文',
    translateShowTranslation: '显示译文',
    translateStarting: '正在准备翻译…',
    translateQueued: '正在排队，完成后会自动显示。',
    translateProgress: '已翻译 {done} / {total} 段…',
    translateFrom: '由 XPut 翻译自 {lang}',
    translateBy: '由 XPut 翻译',
    translatePartial: '有 {failed} 段未能翻译，已保留原文。',
    translateFailed: '翻译失败，请重试。',
    translateBusy: '翻译请求过于频繁，请稍后再试。',
    translateDisclaimer: '机器翻译，可能不准确。',
    translateRetry: '重试未完成部分',
    translateAutoOff: '不再自动翻译',
    translateAutoOn: '开启自动翻译',
    savedNote: '这是保存的副本，原帖可能已修改或删除。',
    postedAndSaved: '{posted} · XPut 保存于 {saved}',
    savedOnly: 'XPut 保存于 {saved}',
    replyOne: '{n} 条回复',
    replyMany: '{n} 条回复',
    another: '下载或查看其他帖子',
    drawerTitle: '下载媒体',
    drawerItems: '· {n} 项',
    drawerFoot: '文件会直接保存到你的设备。按 Esc 或点击空白处关闭。',
    drawerLoading: '正在加载下载选项…',
    drawerLocalNote: '暂时无法访问原帖，以下是随这份副本保存的文件。',
    close: '关闭',
    videoPending: '视频仍在保存中，完成后本页会自动更新。',
    videoFailed: '视频保存失败，你仍可以从原帖下载。',
    photoOf: '第 {n} 张图片',
    removedTitle: '这份副本已被移除',
    removedText: '应作者或权利人的要求已下架。',
    removedRef: '参考编号：{ref}。',
    backToXPut: '返回 XPut',
    notFoundTitle: '这个链接不存在',
    notFoundText: '请检查链接，或粘贴一个 X 帖子链接开始使用。',
    titleTemplate: '{author} 的 X 帖子：“{excerpt}” | XPut'
  },
  featured: {
    breadcrumbSaved: '值得再读',
    breadcrumbLabel: '面包屑导航',
    savedFrom: '来自 X 的已保存帖子 · {date}',
    originalLabel: 'X 上的原帖',
    tag: '摘要与背景由 XPut 提供',
    disclaimer: '非原作者撰写 · AI 辅助生成，{date}',
    summary: '摘要',
    context: '背景',
    keyPoints: '要点',
    spot: '发现错误？',
    reportIt: '反馈给我们',
    moreFrom: '更多来自 {author} 与 {topic} 的帖子',
    moreFromAuthor: '更多来自 {author} 的帖子'
  },

  pages: {
    home: {
      title: '推特视频下载器 – X（Twitter）高清视频在线下载 | XPut',
      description: '免费在线下载推特（X）高清视频，支持 MP4、图片和 GIF。无需登录、无弹窗，粘贴链接即可保存到手机或电脑。',
      badge: '免费 · 无弹窗 · 无需登录',
      h1: { plain: '', mark: '推特视频下载' },
      subtitle: '粘贴 X（推特）帖子链接，免费在线下载高清 MP4 视频，也支持图片和 GIF。无需登录，无弹窗。',
      empty: {
        title: '下载结果会显示在这里',
        text: '视频所有清晰度、图片和 GIF 都会列在这里，文件直接保存到设备，不开新标签页。',
        shortcutDesktop: '用 iPhone？了解一键快捷指令 →',
        shortcutMobile: '用 iPhone？了解一键快捷指令 →'
      },
      steps: {
        h2: '如何下载推特视频',
        items: [
          { title: '复制帖子链接', text: '在 X App 或 x.com 上，点帖子的「分享」→「复制链接」。' },
          { title: '粘贴到 XPut', text: '把链接粘贴到上方输入框，点「下载」。twitter.com 和 x.com 链接都支持。' },
          { title: '保存 MP4', text: '选择高清 1080p 或更小的尺寸，文件直接保存到设备。' }
        ],
        notes: ['小提示：如果一条帖子里有多个视频，或者同时有视频和图片，XPut 会把它们分开列出，你可以只保存需要的那一个。从 X App、x.com 或 twitter.com 复制的链接用法完全一样，粘贴后几秒钟就能看到结果，不用安装任何软件。']
      },
      phones: {
        h2: '在 iPhone 和安卓手机上保存推特视频',
        intro: 'XPut 直接在手机浏览器中使用，无需安装 App。下面是把视频保存到相册的方法。',
        iphone: {
          title: 'iPhone',
          steps: ['在 X App 中复制帖子链接。', '在 Safari 中打开本页，粘贴并点「下载」。', '打开「文件」→「下载」，点「分享」→「存储视频」即可存到相册。'],
          link: '用 iPhone 快捷指令一键保存 →'
        },
        android: {
          title: 'Android',
          steps: ['在 X App 中复制帖子链接。', '在 Chrome 中打开本页，粘贴并点「下载」。', 'MP4 会保存到「下载」，并出现在相册中。']
        },
        note: '下载的文件会直接保存到手机，不会打开新标签页，也不会跳到其他页面。如果点了下载没有反应，请检查浏览器是否允许从 xput.app 下载文件；在微信内置浏览器中打开时，建议先点右上角，选择「在浏览器中打开」再下载。'
      },
      banner: {
        eyebrow: '推特查看器',
        title: '只想看看帖子？',
        text: '无需账号打开任何公开的 X 帖子，并获得原帖删除后依然有效的链接。',
        cta: '试试推特查看器'
      },
      why: {
        h2: '为什么选择 XPut',
        items: [
          { title: '所有清晰度，高清 MP4', text: '列出所有可用分辨率，最高 1080p，保存为 MP4。想留存就选最高画质，流量或空间紧张时选更小的文件。' },
          { title: '视频、图片和 GIF', text: '一个链接拿到帖子里的全部媒体：图片是原图，GIF 是小体积 MP4，含多个视频或图片的帖子会分块清楚列出。' },
          { title: '无弹窗、无跳转', text: '页面上只有一个真正的下载按钮，点了就下载。没有假按钮、不开新标签、不跳到奇怪的页面。' },
          { title: '链接长期有效', text: '点「查看」保存一份副本。即使原帖之后在 X 上被删除，你的 XPut 链接依然能打开，可以放心分享。' }
        ],
        notes: ['很多下载网站充斥着弹窗、跳转和假下载按钮，点错一次就会被带到奇怪的页面。XPut 的出发点正好相反：页面简单、速度快，按钮写的是什么就做什么，手机上也一样好用。']
      },
      faq: {
        h2: '常见问题',
        items: [
          { q: '推特视频怎么下载？', a: '在 X（推特）上点帖子的「分享」→「复制链接」，粘贴到 XPut 的输入框，点「下载」。最上方的按钮会保存 X 提供的最高画质，通常是 1080p；点「其他清晰度」可以选择 720p、480p 等更小的文件。整个过程不需要登录，也不会弹出广告或跳转。' },
          { q: '下载的视频是什么格式？', a: '所有视频都保存为 MP4，这是手机、电脑和大多数播放器都能直接打开的格式。XPut 直接提供 X 服务器上的原始文件，不会重新压缩，所以画质和原帖一致。' },
          { q: '支持 x.com 链接吗？', a: '支持。x.com、twitter.com 和 mobile.twitter.com 的帖子链接都能用，带「?s=20」之类参数的分享链接也可以。请注意粘贴的是单条帖子的链接，而不是个人主页链接。' },
          { q: '怎么保存推特上的 GIF？', a: '粘贴含 GIF 的帖子链接，点「下载」即可。X 把 GIF 存成循环播放的短视频，所以下载得到的是 MP4 文件，体积小、画质好。在微信、WhatsApp、Telegram 中发送时，它仍会像动图一样自动循环播放。' },
          { q: '怎么保存到 iPhone 相册？', a: '在 Safari 中下载后，视频会先保存到「文件」App 的「下载」文件夹。打开它，点「分享」→「存储视频」，就会出现在「照片」里。如果经常保存，可以安装我们的 iPhone 快捷指令，在 X 里点一下就能直接存进相册。' },
          { q: '能下载推特上的图片吗？', a: '可以。粘贴含图片的帖子链接，XPut 会列出所有图片，并提供原始分辨率的文件，比 App 里看到的预览图更清晰。在手机上可以一键把全部图片存进相册，在电脑上可以打包下载。' },
          { q: '需要登录推特账号吗？', a: '不需要。XPut 只处理公开帖子，你不用登录 X，也不用在 XPut 注册账号。我们不会保存你粘贴过的链接记录，下载的文件也不会被我们存档。' }
        ]
      }
    },

    viewer: {
      title: '推特在线查看器 – 无需登录查看 X 推文 | XPut',
      description: '免登录、匿名查看任何公开的 X（推特）帖子。原帖被删除后，保存过的链接依然可以打开。',
      badge: '免登录 · 匿名 · 保存副本',
      h1: { plain: '', mark: '推特查看器' },
      subtitle: '免登录查看任何公开的 X（推特）帖子，匿名浏览；原帖删除后，链接依然有效。',
      empty: {
        title: '帖子会显示在这里',
        text: '无需账号即可阅读。我们会保存副本，原帖删除后链接依然有效。'
      },
      steps: {
        h2: '如何免登录查看推文',
        items: [
          { title: '复制帖子链接', text: '在 X 上「分享」→「复制链接」，或从聊天中复制。' },
          { title: '粘贴到这里', text: '粘贴到上方输入框，点「查看帖子」。' },
          { title: '阅读并分享', text: '阅读完整帖子、图片和视频，并把 XPut 链接分享给任何人。' }
        ],
        notes: [
          '支持从 X App、x.com 和 twitter.com 复制的链接，也包括朋友在聊天软件里发给你的链接。帖子会以干净的阅读版式打开，图片和视频都能直接查看，不会被登录弹窗挡住。',
          '很多人在国内外的聊天群、论坛或新闻里看到一条推特链接，点开却被要求登录或下载 App。用 XPut，只要复制那条链接粘贴到上方，就能直接看到完整内容。看完之后，你还可以把 XPut 生成的短链接转发给朋友，对方同样不需要推特账号就能打开。'
        ]
      },
      anonymous: {
        h2: '匿名查看 X 帖子',
        items: [
          { title: '无需账号', text: '不用登录 X，也不用注册任何账号。粘贴链接，帖子立刻打开。' },
          { title: '不留下痕迹', text: '作者看不到谁查看了帖子，我们也不保存你的阅读记录。' },
          { title: '方便分享', text: '每条帖子都有简短干净的链接，在微信、WhatsApp、Telegram 等聊天软件中显示完整预览。' },
          { title: '只支持单条帖子', text: '只打开你粘贴的那条帖子，不支持主页、时间线或搜索，保持简单，也尊重他人的账号。' }
        ],
        notes: ['因为帖子由 XPut 代为打开，你不需要登录 X，X 也无法在你的浏览器里留下追踪记录，作者更不会收到任何通知。对只想看一眼内容的人来说，这是最省事、也最安心的方式。']
      },
      lasting: {
        h2: '链接长期有效',
        paragraphs: [
          '在 XPut 上查看帖子时，我们会保存一份副本。即使作者之后删除了原帖，你的 XPut 链接仍会显示保存的版本，适合保存想留下的推文。注意：只有在删除前已在 XPut 保存过的帖子才能看到。',
          '每份副本都会标注保存日期，读者能清楚知道自己看到的是哪个时间点的版本。如果你是帖子作者，希望删除 XPut 上保存的副本，可以通过「举报内容」页面提交申请，我们审核后会尽快处理。',
          '这一点在推特上尤其有用：很多引起讨论的帖子会在几小时内被作者删除，原链接随之失效。如果你在它被删除前已经用 XPut 查看过，手里的 XPut 链接仍然能打开当时保存的内容，方便日后回看、引用或作为参考。需要注意的是，XPut 只保存公开帖子，不支持私密账号的内容。'
        ]
      },
      banner: {
        eyebrow: '视频下载',
        title: '想保存视频？',
        text: '以高清下载任何 X 帖子中的视频、GIF 和图片。',
        cta: '去下载'
      },
      faq: {
        h2: '常见问题',
        items: [
          { q: '不登录能看推特吗？', a: '可以。把任何公开帖子的链接粘贴到上方，点「查看帖子」就能阅读全文、图片和视频，不需要 X 账号，也不用在 XPut 注册。' },
          { q: '这个查看器是匿名的吗？', a: '是的。帖子由 XPut 获取，原作者和 X 都看不到是谁查看了它。我们不要求登录，也不会记录你查看过哪些帖子。' },
          { q: '原帖被删除后会怎样？', a: '在 XPut 查看帖子时，我们会保存一份副本。即使作者之后删除了原帖，你的 XPut 链接仍会显示保存的版本，并注明保存日期。' },
          { q: '能看已删除的推文吗？', a: '只能看到在删除之前已经在 XPut 保存过的帖子。如果一条推文从未在 XPut 上被查看或保存过，删除后我们也无法找回。想留住重要的推文，最好趁它还在时先点一次「查看」。' },
          { q: '能看某人的整个主页吗？', a: '不能。XPut 只支持单条帖子链接，不提供账号搜索、主页浏览或时间线功能。粘贴个人主页链接时，页面会提示你改为粘贴单条帖子的链接。' },
          { q: '能看评论回复吗？', a: '页面会显示回复数量，但不会抓取回复内容。想阅读回复，可以点「在 X 打开」，在 X 上查看完整讨论。' }
        ]
      }
    },

    shortcut: {
      title: 'iPhone 一键保存推特视频 – XPut 快捷指令',
      description: '用免费的 XPut 快捷指令，在 iPhone 上一键把 X（推特）视频和图片存进「照片」。无需安装 App、无需账号、无需复制粘贴。',
      badge: 'iPhone · iPad · 免费',
      h1: { plain: '在 iPhone 上', mark: '一键保存 X 视频' },
      subtitle: '添加免费的 XPut 快捷指令，在任意帖子上点「分享」→「XPut」，视频或图片直接存进「照片」，无需复制粘贴。',
      get: {
        button: '获取快捷指令',
        note: '在 iPhone 或 iPad 的「快捷指令」App 中打开。免费，无需账号。',
        qrTitle: '用 iPhone 相机扫码',
        qrText: '快捷指令仅适用于 iPhone 和 iPad。扫码，或在手机上打开本页。',
        qrLabel: 'XPut 快捷指令的 iCloud 二维码',
        open: '打开 iCloud 链接',
        copy: '复制链接',
        copied: '链接已复制'
      },
      steps: {
        h2: 'iPhone 快捷指令怎么用',
        items: [
          { title: '添加快捷指令', text: '点「获取快捷指令」，然后在「快捷指令」App 中点「添加快捷指令」。' },
          { title: '在 X 上分享帖子', text: '在 X App 中点帖子的「分享」→「通过…分享」，选择「XPut」。' },
          { title: '在「照片」中查看', text: '自动保存最高画质；图片保存为原图。' }
        ],
        notes: ['首次运行时，iOS 会询问是否允许连接 xput.app 并向「照片」添加内容。点一次「允许」，之后不会再问。']
      },
      banner: {
        eyebrow: '不想装快捷指令？',
        title: '直接在 Safari 中使用',
        text: '在首页粘贴帖子链接，即可下载高清视频。',
        cta: '前往视频下载'
      },
      faq: {
        h2: '常见问题',
        items: [
          { q: '快捷指令安全吗？', a: '它只把帖子链接发给 XPut 并保存返回的文件。你可以在「快捷指令」App 里打开它，查看每一步。' },
          { q: '分享菜单里为什么没有 XPut？', a: '滑到分享菜单底部，点「编辑操作」，把 XPut 加入收藏。如果刚添加完快捷指令，请先关闭 X App 再重新打开。' },
          { q: 'iPad 能用吗？', a: '可以。装有「快捷指令」App 的 iPad 和 iPhone 都能使用。安卓手机和电脑不支持，请在首页使用视频下载。' },
          { q: '需要 X 账号吗？', a: '不需要 XPut 账号。快捷指令从 X App 的「分享」按钮开始，只会发送你所分享帖子的链接。' },
          { q: '能选择清晰度吗？', a: '快捷指令会自动保存可用的最高画质。如果想要更小的文件，请在 Safari 中使用 XPut 并选择其他清晰度。' }
        ]
      }
    },

    report: {
      title: '举报或删除内容 | XPut',
      description: '申请 XPut 下架某个帖子的保存副本。我们会审核每一项申请。',
      h1: '举报或删除内容',
      intro: '请求我们下架 XPut 上的保存副本。我们会审核每一项申请，通常在 {time}内回复。',
      time: '3 个工作日',
      form: {
        link: 'XPut 链接或 X 帖子链接',
        linkPlaceholder: 'https://xput.app/…',
        reason: '原因',
        reasons: [
          { value: 'author', kind: 'other', label: '我是作者，希望删除我的副本' },
          { value: 'copyright', kind: 'copyright', label: '侵犯版权（DMCA）' },
          { value: 'harmful', kind: 'other', label: '有害或违法内容' },
          { value: 'other', kind: 'other', label: '其他' }
        ],
        email: '你的邮箱',
        emailPlaceholder: 'name@example.com',
        details: '详细说明',
        detailsPlaceholder: '任何有助于我们审核的信息',
        confirm: '我确认以上信息真实准确。',
        submit: '提交申请',
        sending: '正在提交…'
      },
      contactEmailLine: '版权投诉和删除请求也可以发送到 {email}。',
      next: {
        title: '接下来会发生什么',
        items: ['我们会通过邮件确认已收到你的申请。', '我们会进行审核，通常在 {time}内完成。', '审核通过后，副本会被移除，其链接将显示下架说明。']
      },
      result: {
        sent: '申请已收到，编号 {id}。我们会审核并通过邮件回复。',
        sentNoId: '申请已收到。我们会审核并通过邮件回复。',
        invalid: '请检查链接并填写所有必填项。',
        notFound: '没有找到这份保存的副本，请检查链接后重试。',
        tooMany: '请求过于频繁，请等一分钟后再试。',
        failed: '出了点问题，请稍后重试。'
      }
    },

    privacy: {
      title: '隐私政策 | XPut',
      description: 'XPut 如何处理链接、保存的副本和 Cookie。',
      h1: '隐私政策',
      updated: '最后更新于 {date}',
      updatedOn: '2026-10-03',
      analyticsGeneric: '一款注重隐私的统计工具',
      contactEmailLine: '你也可以通过 {email} 联系我们。版权投诉和删除请求均可发送到该邮箱。',
      toc: '本页内容',
      short: {
        title: '简要说明',
        items: [
          '无需账号，无需注册。',
          '我们不保存你粘贴过的链接记录。',
          '你「查看」的帖子会被公开保存，让链接持续有效。',
          '日后如有广告，会明确标注，且绝不弹窗。'
        ]
      },
      sections: [
        { id: 'collect', title: '我们收集什么', paragraphs: [
          '当你粘贴链接时，我们会把它发送到服务器，获取公开的帖子并向你展示结果。由于没有账号，我们不会把你粘贴的内容与任何账号关联，也不会保存你粘贴过的链接记录。',
          '与大多数网站一样，我们的服务器会短暂记录 IP 地址、浏览器类型等技术数据，用于保障服务安全和限制滥用。我们还使用{analytics}来汇总统计访问量。'
        ] },
        { id: 'saved', title: '保存的副本', paragraphs: [
          '当你点「查看」时，XPut 会保存这条公开帖子的副本：正文、图片、视频、作者名称与用户名，以及相关日期。副本有一个公开的 XPut 链接，即使原帖被删除，链接依然有效。除非我们将其精选，否则保存的副本不会被搜索引擎收录。',
          '如果某份副本属于你，或侵犯了你的权利，你可以申请移除（见「你的选择」）。'
        ] },
        { id: 'cookies', title: 'Cookie', paragraphs: [
          '我们使用一个 Cookie 记住你的语言偏好；当帖子可能包含敏感内容时，还会使用一个会话 Cookie 记住你在本次访问中已确认年龄。我们不会用 Cookie 跨站追踪你。如果日后加入广告，广告合作方可能设置 Cookie，我们会先更新本页。'
        ] },
        { id: 'ads', title: '广告', paragraphs: [
          'XPut 目前不展示广告。如果日后加入，广告会明确标注，绝不弹窗或跳转，也绝不会替代下载按钮。'
        ] },
        { id: 'choices', title: '你的选择与删除申请', paragraphs: [
          '你无需向我们提供任何个人信息即可使用 XPut。如需申请移除某份保存的副本，请前往「举报内容」页面。我们会审核每一项申请，通常在 3 个工作日内回复。'
        ], link: { href: 'report', label: '举报内容' } },
        { id: 'contact', title: '联系我们', paragraphs: [
          '对本政策有疑问？请通过「举报内容」页面联系我们，我们会尽快回复。'
        ] }
      ]
    },

    browse: {
      title: '值得再读 – XPut 上公开保存的 X（推特）帖子 | XPut',
      description: '浏览在 XPut 上保存的公开 X（推特）帖子。即使原帖之后被删除，这些链接依然有效。',
      h1: '值得再读',
      subtitle: '在 XPut 上保存、值得再读一遍的公开 X 帖子。即使原帖被删除，链接依然有效。',
      searchLabel: '搜索值得再读的帖子',
      placeholder: '按内容、作者或 @用户名搜索',
      search: '搜索',
      resultsFor: '“{q}”的搜索结果',
      emptyAll: '暂时还没有可浏览的帖子，稍后再来看看。',
      emptySearch: '没有找到与“{q}”相关的帖子。',
      clear: '显示全部',
      prev: '← 上一页',
      next: '下一页 →',
      pageN: '第 {n} 页',
      pagination: '分页',
      tooLong: '搜索词太长了。'
    },

    notFound: {
      title: '页面未找到 | XPut',
      h1: '页面未找到',
      text: '链接可能有误，或页面已被移动。粘贴一个 X 帖子链接即可开始使用。'
    }
  }
};
