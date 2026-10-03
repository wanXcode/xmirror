// English UI strings and page copy (the fallback language).
// Page copy comes from docs/design (DESIGN-SPEC section 7 and the artboards);
// test/copy-matches-design.test.js checks it against the artboards.
module.exports = {
  ui: {
    skipToContent: 'Skip to content',
    menu: 'Menu',
    closeMenu: 'Close menu',
    mainNav: 'Main',
    language: 'Language',
    comingSoon: 'coming soon'
  },
  nav: {
    downloader: 'Video Downloader',
    viewer: 'Twitter Viewer',
    shortcut: 'iPhone Shortcut'
  },
  footer: {
    browse: 'Worth reading',
    tagline: 'Clean X video downloader and viewer. No pop-ups, no redirects.',
    notAffiliated: 'Not affiliated with X Corp.',
    privacy: 'Privacy',
    report: 'Report content'
  },

  // Link box, its states, and the temporary result list (replaced by result cards in phase 3).
  input: {
    label: 'X post link',
    placeholder: 'Paste X post link',
    paste: 'Paste',
    download: 'Download',
    view: 'View',
    viewPost: 'View post',
    fetching: 'Fetching…',
    saving: 'Saving…',
    clipboardFound: 'Link found in your clipboard —',
    clipboardFill: 'tap to fill',
    pasteFailed: 'Long-press the box to paste',
    errEmpty: 'Paste an X post link first.',
    errInvalid: "That isn't an X post link. It should look like x.com/name/status/123…",
    errNotSingle: 'Paste a link to a single post, not a profile.',
    loadingNote: 'Fetching the post from X. This usually takes a few seconds.',
    unavailable: {
      title: "This post isn't available",
      text: "It may have been deleted, or it's from a private or suspended account.",
      textNoCopy: "We don't have a saved copy of this post.",
      check: 'Check for a saved copy',
      another: 'Try another link'
    },
    rejected: {
      title: "This post can't be shown",
      text: "It doesn't meet XPut's content rules.",
      another: 'Try another link'
    },
    busy: {
      title: 'XPut is busy right now',
      text: "We couldn't reach X in time. Your link is fine — please try again.",
      retry: 'Try again'
    },
    tooMany: {
      title: 'Too many requests',
      text: "You've made a lot of requests in a short time. Please wait a moment.",
      retryIn: 'Try again in {time}',
      retry: 'Try again'
    },
    sensitive: {
      title: 'Sensitive content',
      textDownload: 'This post is marked as sensitive on X. Confirm you are 18 or older to see it and get the download links.',
      textView: 'This post is marked as sensitive on X. Confirm you are 18 or older to see it.',
      confirm: 'I am 18 or older – show',
      back: 'Go back'
    },
    saved: {
      title: 'Saving a copy…',
      note: 'Your link will keep working even if the post is deleted.',
      already: 'Already saved on {date}',
      opening: 'Opening the saved copy…'
    }
  },

  // Result cards, download feedback and platform tips (docs/design: W_Results, W_Feedback).
  result: {
    pillVideo: 'Video',
    pillVideos: '{n} videos',
    pillVideoCount: '{n} video',
    pillGif: 'GIF',
    pillGifs: '{n} GIFs',
    pillPhoto: '1 photo',
    pillPhotos: '{n} photos',
    pillQuotedVideo: 'Quoted video',
    pillQuotedGif: 'Quoted GIF',
    pillQuotedPhotos: 'Quoted photos',
    pillQuotedMedia: 'Quoted media',
    labelPhoto: '1 photo · original size',
    labelPhotos: '{n} photos · original size',
    gifLoops: 'GIF · loops',
    play: 'Play preview',
    downloadHd: 'Download HD · {quality}',
    downloadQuality: 'Download · {quality}',
    infoVideo: 'Video · {quality} · {size}',
    infoVideoNoSize: 'Video · {quality}',
    infoGif: 'GIF · {size}',
    infoGifNoSize: 'GIF',
    rowVideo: 'Video',
    rowGif: 'GIF',
    rowGifSaved: 'Saved as MP4',
    rowPhoto: '1 photo',
    rowPhotos: '{n} photos',
    rowPhotosNote: 'original size',
    selectedCount: '{n} selected',
    zipShort: 'Download {n} (ZIP)',
    saveToPhotosShort: 'Save {n} to Photos',
    gifButtonShort: 'Download GIF',
    qualityMp4: '{quality} · MP4',
    otherQualities: 'Other qualities',
    variantDownload: 'Download',
    variantDownloadSize: 'Download · {size}',
    downloading: 'Downloading…',
    downloadingPercent: 'Downloading… {percent}%',
    saved: 'Saved',
    failed: 'Download failed — tap to try again',
    retryIn: 'Try again in {time}',
    photosHint: 'Tap a photo to view it full screen. Tap the circle to select.',
    openPhoto: 'Open photo {n} full screen',
    selectPhoto: 'Select photo {n}',
    zip: 'Download {n} photos (ZIP)',
    zipOne: 'Download photo',
    saveToPhotos: 'Save {n} photos to Photos',
    saveOneToPhotos: 'Save photo to Photos',
    selectSome: 'Select photos to download',
    originalSize: 'Original size',
    gifButton: 'Download GIF (MP4)',
    gifNote: 'X stores GIFs as short looping videos, so it saves as MP4. It still plays as a GIF in WhatsApp and Telegram.',
    viewSave: 'View & save a copy',
    openOnX: 'Open on X',
    copyText: 'Copy text',
    copied: 'Copied',
    noMedia: 'This post has no video, GIF or images to download.',
    fromQuoted: 'From the quoted post · @{handle}',
    lastHint: 'Want this link to last?',
    lightboxCounter: '{index} / {total}',
    lightboxLabel: 'Photo full screen',
    saveThisPhoto: 'Save this photo',
    pressHold: 'Or press and hold the photo to save it',
    close: 'Close',
    previous: 'Previous photo',
    next: 'Next photo',
    dismiss: 'Dismiss',
    tipIosTitle: 'Saved to Files',
    tipIosText: 'Open Files → Downloads, tap Share → Save Video to add it to Photos.',
    tipIosLink: 'Get the one-tap Shortcut →',
    tipAndroidTitle: 'Saved to Downloads',
    tipAndroidText: "You'll also find it in your Gallery."
  },

  // Saved-post page /{shortCode}: normal and featured (docs/design: W_Copy*, W_Featured*).
  post: {
    h1Suffix: 'on X',
    copyLink: 'Copy link',
    shareLink: 'Share link',
    linkCopied: 'Link copied',
    linkCopiedToast: 'Link copied — paste it anywhere to share',
    downloadMedia: 'Download media',
    openOnX: 'Open on X',
    savedNote: 'This is a saved copy. The original post may have changed or been removed.',
    postedAndSaved: '{posted} · Saved by XPut on {saved}',
    savedOnly: 'Saved by XPut on {saved}',
    replyOne: '{n} reply',
    replyMany: '{n} replies',
    another: 'Save or view another post',
    drawerTitle: 'Download media',
    drawerItems: '· {n} items',
    drawerFoot: 'Files save straight to your device. Esc or tap outside to close.',
    drawerLoading: 'Loading download options…',
    drawerLocalNote: 'The original post is not reachable right now, so these are the files saved with this copy.',
    close: 'Close',
    videoPending: 'The video is still being saved. This page updates when it is ready.',
    videoFailed: 'The video could not be saved. You can still download it from the original post.',
    photoOf: 'Photo {n}',
    removedTitle: 'This copy was removed',
    removedText: "It was taken down at the author's or rights holder's request.",
    removedRef: 'Reference: {ref}.',
    backToXPut: 'Back to XPut',
    notFoundTitle: "This link doesn't exist",
    notFoundText: 'Check the link, or paste an X post link to get started.',
    titleTemplate: '{author} on X: "{excerpt}" | XPut'
  },
  featured: {
    breadcrumbSaved: 'Worth reading',
    breadcrumbLabel: 'Breadcrumb',
    savedFrom: 'Saved post from X · {date}',
    originalLabel: 'Original post on X',
    tag: 'Summary and context by XPut',
    disclaimer: "Not written by the post's author · AI-assisted, {date}",
    summary: 'Summary',
    context: 'Context',
    keyPoints: 'Key points',
    spot: 'Spot a mistake?',
    reportIt: 'Report it',
    moreFrom: 'More from {author} and {topic}',
    moreFromAuthor: 'More from {author}'
  },

  pages: {
    home: {
      title: 'Twitter Video Downloader – Download X Videos in HD | XPut',
      description: 'Download videos, GIFs and images from X (Twitter) in HD. Free, no sign-up, no pop-ups. Paste a link and save MP4 to your phone or computer.',
      badge: 'Free · No pop-ups · No sign-up',
      h1: { plain: 'X (Twitter) ', mark: 'Video Downloader' },
      subtitle: 'Download X videos in HD as MP4 — plus images and GIFs. Paste a post link and save it to your phone or computer.',
      empty: {
        title: 'Your downloads show up here',
        text: 'Videos in every quality, plus images and GIFs. Files save straight to your device — no new tabs.',
        shortcutDesktop: 'Using an iPhone? See the one-tap Shortcut →',
        shortcutMobile: 'iPhone? Get the one-tap Shortcut →'
      },
      steps: {
        h2: 'How to download X (Twitter) videos',
        items: [
          { title: 'Copy the post link', text: 'In the X app or on x.com, tap Share on the post, then Copy link.' },
          { title: 'Paste it into XPut', text: 'Paste the link above and tap Download. Twitter.com and x.com links both work.' },
          { title: 'Save the MP4', text: 'Pick HD 1080p or a smaller size. The file saves straight to your device.' }
        ],
        notes: ['Tip: if a post has more than one video or a mix of videos and photos, XPut shows each one separately, so you can save exactly what you need. Links from the X app, x.com and twitter.com all work the same way.']
      },
      phones: {
        h2: 'Download Twitter videos on iPhone and Android',
        intro: "XPut works in your phone's browser — no app to install. Here's how to save a video so it ends up in your gallery.",
        iphone: {
          title: 'iPhone',
          steps: ['Copy the post link in the X app.', 'Paste it here in Safari and tap Download.', 'Open Files → Downloads, tap Share → Save Video to add it to Photos.'],
          link: 'Save in one tap with the iPhone Shortcut →'
        },
        android: {
          title: 'Android',
          steps: ['Copy the post link in the X app.', 'Paste it here in Chrome and tap Download.', 'The MP4 saves to Downloads and shows up in your Gallery.']
        },
        note: "Downloads go straight to your phone, with no new tabs and no extra pages. If a download doesn't start, check that your browser allows downloads from xput.app."
      },
      banner: {
        eyebrow: 'Twitter Viewer',
        title: 'Just want to read a post?',
        text: "Open any public X post without an account — and keep a link that works even after it's deleted.",
        cta: 'Try our Twitter Viewer'
      },
      why: {
        h2: 'Why use XPut',
        items: [
          { title: 'Every quality in HD', text: 'All available resolutions, up to 1080p, saved as MP4. Pick the best quality for keeping, or a smaller file when your data or storage is limited.' },
          { title: 'Videos, images and GIFs', text: 'One link gets everything in the post. Photos come at original size, GIFs as small MP4 files, and posts with several videos or photos are split into clear sections.' },
          { title: 'No pop-ups or redirects', text: 'There is one real download button and it downloads the file. No fake buttons, no new tabs, no surprise pages — the way a downloader should work.' },
          { title: 'Links that last', text: 'Tap View to save a copy of the post. Your XPut link keeps working even if the original is later deleted on X, so you can share it with confidence.' }
        ],
        notes: ['Most downloader sites are full of pop-ups and fake buttons. XPut was built to be the opposite: simple, fast and honest about what it does.']
      },
      faq: {
        h2: 'Frequently asked questions',
        items: [
          { q: 'How do I download a Twitter video in HD?', a: 'Copy the post link from X (tap Share → Copy link), paste it into XPut and tap Download. The top button saves the highest quality X provides, usually 1080p. If you need a smaller file, tap Other qualities and choose 720p, 480p or 360p. There is nothing to install and no sign-up.' },
          { q: 'Can I convert a Twitter video to MP4?', a: 'Every video downloads as an MP4 file, so there is no separate conversion step. XPut gives you the original file stored on X, without re-encoding, so the quality matches the post. MP4 plays on iPhone, Android, Windows and Mac without extra apps.' },
          { q: 'Does it work with x.com links?', a: 'Yes. Links from x.com, twitter.com and mobile.twitter.com all work, including share links with extra parameters like ?s=20. Just make sure you paste a link to a single post, not to a profile or a search page.' },
          { q: 'How do I save a Twitter GIF?', a: 'Paste the link of a post with a GIF and tap Download. X stores GIFs as short looping videos, so you get a small MP4 file with full quality. It still loops like a GIF when you send it in WhatsApp, Telegram or iMessage.' },
          { q: 'How do I download Twitter videos on iPhone?', a: 'Open XPut in Safari, paste the link and tap Download. The video saves to the Files app first; open Files → Downloads, tap Share and choose Save Video to move it to Photos. If you save videos often, our free iPhone Shortcut does it in one tap from the X app.' },
          { q: 'Can I download images from a tweet?', a: 'Yes. Paste a post with photos and XPut lists every image at its original resolution, which is sharper than the preview in the X app. On a phone you can save all photos to your gallery at once; on a computer you can download them together as a ZIP.' },
          { q: 'Is XPut free and safe to use?', a: 'XPut is free and works without an account. There are no pop-ups, redirects or fake download buttons, and files download directly to your device. We do not keep a history of the links you paste or store the files you download.' }
        ]
      }
    },

    viewer: {
      title: 'Twitter Viewer – View X Posts Without an Account | XPut',
      description: 'View any public X (Twitter) post anonymously, no login or account needed. Links keep working even if the original post is deleted.',
      badge: 'No login · Anonymous · Saved copies',
      h1: { plain: 'Twitter ', mark: 'Viewer' },
      subtitle: 'View any public X post anonymously, without an account. Paste a link to read it — your link keeps working even if the post is deleted.',
      empty: {
        title: 'The post opens here',
        text: 'Read it without an account. We keep a copy, so your link still works if the post is deleted.'
      },
      steps: {
        h2: 'How to view tweets without an account',
        items: [
          { title: 'Copy the post link', text: 'Share → Copy link on X, or copy it from a message.' },
          { title: 'Paste it here', text: 'Paste the link above and tap View post.' },
          { title: 'Read and share', text: 'Read the full post with images and video. Share the XPut link with anyone.' }
        ],
        notes: ['It works with links from the X app, x.com and twitter.com, including links people send you in chat apps. The post opens in a clean reading layout with its photos and video.']
      },
      anonymous: {
        h2: 'View X posts anonymously',
        items: [
          { title: 'No account needed', text: 'Read posts without logging in to X or signing up for anything. Paste a link and the post opens right away.' },
          { title: 'Nothing left behind', text: "The author can't see who viewed the post, and we don't keep a history of what you read." },
          { title: 'Easy to share', text: 'Every post gets a short, clean link with a proper preview in WhatsApp, Telegram and other chat apps.' },
          { title: 'Single posts only', text: "We open the post you paste — no profiles, timelines or search. That keeps XPut simple and respectful of people's accounts." }
        ],
        notes: ['Because XPut opens the post for you, there is no X login, no tracking cookie from X and no notification to the author.']
      },
      lasting: {
        h2: 'Links that last',
        paragraphs: [
          'When you view a post on XPut, we save a copy. If the author later deletes it, your XPut link still shows the saved version — handy for saving tweets you want to keep. You can only see deleted tweets that were saved on XPut before they were removed.',
          'Each saved copy shows the date it was saved, so readers always know which version they are looking at. If you are the author and want a saved copy removed, you can ask us through the Report content page.'
        ]
      },
      banner: {
        eyebrow: 'Video Downloader',
        title: 'Want to save the video?',
        text: 'Download videos, GIFs and images from any X post in HD.',
        cta: 'Download it here'
      },
      faq: {
        h2: 'Frequently asked questions',
        items: [
          { q: 'Can I view Twitter without logging in?', a: "Yes. Paste a link to any public post and tap View post to read the full text, photos and video. You don't need an X account, and you don't need to sign up for XPut either." },
          { q: 'Is this Twitter viewer anonymous?', a: "Yes. XPut fetches the post for you, so neither the author nor X can see who viewed it. We don't ask you to log in and we don't keep a record of which posts you looked at." },
          { q: 'What happens if the post is deleted?', a: 'When you view a post on XPut, we save a copy. If the author later deletes the original, your XPut link still shows the saved version, along with the date it was saved.' },
          { q: 'Can I see deleted tweets?', a: "Only if the post was saved on XPut before it was deleted. XPut can't recover deleted tweets that were never viewed or saved here. If a post matters to you, view it on XPut while it's still online so a copy is kept." },
          { q: "Can I see someone's whole profile?", a: "No. XPut works with links to single posts only — there is no account search, profile browsing or timeline. If you paste a profile link, we'll ask you to paste a link to a specific post instead." },
          { q: 'Can I see replies?', a: "We show how many replies a post has, but we don't load the replies themselves. Tap Open on X to read the full conversation there." }
        ]
      }
    },

    shortcut: {
      title: 'Download Twitter Videos on iPhone – One-Tap Shortcut | XPut',
      description: 'Save X (Twitter) videos and photos to your iPhone in one tap with the free XPut Shortcut. No app, no account, no copy and paste.',
      badge: 'iPhone · iPad · Free',
      h1: { plain: 'Save X videos on iPhone in ', mark: 'one tap' },
      subtitle: 'Add the free XPut Shortcut, then tap Share → XPut on any post. The video or photos go straight to your Photos app — no copy and paste.',
      get: {
        button: 'Get the Shortcut',
        note: 'Opens in the Shortcuts app on iPhone or iPad. Free, no account.',
        qrTitle: 'Scan with your iPhone camera',
        qrText: 'The Shortcut only works on iPhone and iPad. Scan the code, or open this page on your phone.',
        qrLabel: 'QR code for the XPut Shortcut on iCloud',
        open: 'Open iCloud link',
        copy: 'Copy link',
        copied: 'Link copied'
      },
      steps: {
        h2: 'How the iPhone Shortcut works',
        items: [
          { title: 'Add the Shortcut', text: 'Tap Get the Shortcut, then Add Shortcut in the Shortcuts app.' },
          { title: 'Share a post on X', text: 'In the X app, tap Share on a post, then Share via… and choose XPut.' },
          { title: 'Find it in Photos', text: 'The best quality saves automatically. Photos save at original size.' }
        ],
        notes: ["The first time you run it, iOS asks to allow the Shortcut to connect to xput.app and to add items to Photos. Tap Allow once and it won't ask again."]
      },
      banner: {
        eyebrow: 'No Shortcut?',
        title: 'Use XPut in Safari instead',
        text: 'Paste a post link on our homepage and download in HD.',
        cta: 'Go to Video Downloader'
      },
      faq: {
        h2: 'Frequently asked questions',
        items: [
          { q: 'Is the Shortcut safe?', a: 'It only sends the post link to XPut and saves the file it gets back. You can open it in the Shortcuts app and read every step.' },
          { q: "Why doesn't XPut appear in the share sheet?", a: 'Scroll to the bottom of the share sheet, tap Edit Actions and add XPut to your favorites. If you only just added the Shortcut, close the X app and open it again.' },
          { q: 'Does it work on iPad?', a: 'Yes. The Shortcut works on iPad and iPhone with the Shortcuts app. It does not work on Android or on a computer; use the Video Downloader on our homepage there.' },
          { q: 'Do I need an X account?', a: "You don't need an XPut account. The Shortcut starts from the Share button in the X app and only sends the link of the post you share." },
          { q: 'Can I choose the video quality?', a: 'The Shortcut saves the best quality available automatically. If you want a smaller file, use XPut in Safari and pick another quality.' }
        ]
      }
    },

    report: {
      title: 'Report or Remove Content | XPut',
      description: 'Ask XPut to take down a saved copy of a post. We review every request.',
      h1: 'Report or remove content',
      intro: 'Ask us to take down a saved copy on XPut. We review every request and usually respond within {time}.',
      time: '3 business days',
      form: {
        link: 'XPut link or X post link',
        linkPlaceholder: 'https://xput.app/…',
        reason: 'Reason',
        reasons: [
          { value: 'author', kind: 'other', label: "I'm the author and want my copy removed" },
          { value: 'copyright', kind: 'copyright', label: 'Copyright infringement (DMCA)' },
          { value: 'harmful', kind: 'other', label: 'Harmful or illegal content' },
          { value: 'other', kind: 'other', label: 'Something else' }
        ],
        email: 'Your email',
        emailPlaceholder: 'name@example.com',
        details: 'Details',
        detailsPlaceholder: 'Anything that helps us review the request',
        confirm: 'I confirm the information above is accurate.',
        submit: 'Send request',
        sending: 'Sending…'
      },
      contactEmailLine: 'Copyright complaints and removal requests can also be sent to {email}.',
      next: {
        title: 'What happens next',
        items: ['We confirm we got your request by email.', 'We review it, usually within {time}.', 'If approved, the copy is removed and its link shows a removal notice.']
      },
      result: {
        sent: 'Request received. Your reference is {id}. We will review it and reply by email.',
        sentNoId: 'Request received. We will review it and reply by email.',
        invalid: 'Please check the link and fill in every field.',
        notFound: "We couldn't find that saved copy. Check the link and try again.",
        tooMany: 'Too many requests. Please wait a minute and try again.',
        failed: 'Something went wrong. Please try again in a moment.'
      }
    },

    privacy: {
      title: 'Privacy Policy | XPut',
      description: 'How XPut handles links, saved copies and cookies.',
      h1: 'Privacy policy',
      updated: 'Last updated {date}',
      updatedOn: '2026-10-03',
      analyticsGeneric: 'a privacy-friendly analytics tool',
      contactEmailLine: 'You can also write to us at {email}. Use this address for copyright complaints and removal requests.',
      toc: 'On this page',
      short: {
        title: 'The short version',
        items: [
          'No account, no sign-up.',
          "We don't keep a history of the links you paste.",
          'Posts you View are saved publicly so the link keeps working.',
          'Ads, when added, are labeled and never pop up.'
        ]
      },
      sections: [
        { id: 'collect', title: 'What we collect', paragraphs: [
          'When you paste a link, we send it to our server to fetch the public post and show you the result. We do not link what you paste to an account, because there are no accounts, and we do not keep a history of the links you paste.',
          'Like most websites, our servers briefly record technical data such as your IP address and browser type to keep the service secure and to limit abuse. We also use {analytics} to count visits in aggregate.'
        ] },
        { id: 'saved', title: 'Saved copies', paragraphs: [
          'When you tap View, XPut saves a copy of that public post: its text, photos, video, the author\'s name and handle, and the dates. The copy has a public XPut link so it keeps working even if the original is deleted. Saved copies are not listed in search engines unless we feature them.',
          'If a saved copy is yours or infringes your rights, you can ask us to remove it (see Your choices).'
        ] },
        { id: 'cookies', title: 'Cookies', paragraphs: [
          'We use one cookie to remember your language, and one session cookie that remembers you confirmed your age for the current visit when a post may be sensitive. We do not use cookies to track you across other sites. If we add advertising, its partners may set cookies, and we will update this page first.'
        ] },
        { id: 'ads', title: 'Advertising', paragraphs: [
          'XPut does not show ads today. If we add them, they will be clearly labeled, will never pop up or redirect, and will never replace the download button.'
        ] },
        { id: 'choices', title: 'Your choices and removal requests', paragraphs: [
          'You can use XPut without giving us any personal information. To ask us to remove a saved copy, use the Report content page. We review every request and usually respond within 3 business days.'
        ], link: { href: 'report', label: 'Report content' } },
        { id: 'contact', title: 'Contact', paragraphs: [
          'Questions about this policy? Send them through the Report content page and we will get back to you.'
        ] }
      ]
    },

    browse: {
      title: 'Worth Reading – Public X (Twitter) Posts Saved on XPut | XPut',
      description: 'Browse public X (Twitter) posts saved on XPut. Every link keeps working even if the original post is later deleted.',
      h1: 'Worth reading',
      subtitle: 'Public X posts saved on XPut that are worth a second read. Each link keeps working even if the original is deleted.',
      searchLabel: 'Search posts',
      placeholder: 'Search by text, author or @handle',
      search: 'Search',
      resultsFor: 'Results for “{q}”',
      emptyAll: 'There are no saved posts to browse yet. Check back soon.',
      emptySearch: 'No saved posts match “{q}”.',
      clear: 'Show all',
      prev: '← Previous',
      next: 'Next →',
      pageN: 'Page {n}',
      pagination: 'Pages',
      tooLong: 'That search is too long.'
    },

    notFound: {
      title: 'Page not found | XPut',
      h1: 'Page not found',
      text: 'The link may be broken or the page has moved. Paste an X post link to get started.'
    }
  }
};
