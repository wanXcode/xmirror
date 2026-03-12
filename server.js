const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { createModerator, ModerationRejectError } = require('./lib/moderation');

const app = express();
const PORT = process.env.PORT || 3000;

const TRANSLATE_PROVIDER = process.env.TRANSLATE_PROVIDER || 'siliconflow';
const SILICONFLOW_BASE_URL = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '');
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2-7B-Instruct';
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY || '';
const MODERATION_ADMIN_TOKEN = process.env.MODERATION_ADMIN_TOKEN || '';

app.use(express.json());

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const ARCHIVES_DIR = process.env.ARCHIVES_DIR || path.join(ROOT_DIR, 'archives');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const moderator = createModerator({
  rulesPath: path.join(ROOT_DIR, 'config', 'moderation-rules.json'),
  logPath: path.join(DATA_DIR, 'moderation.log.jsonl')
});
const MODERATION_SETTINGS_PATH = path.join(DATA_DIR, 'moderation-settings.json');
const MODERATION_LOG_PATH = path.join(DATA_DIR, 'moderation.log.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'videos'), { recursive: true });

for (const dir of [DATA_DIR, ARCHIVES_DIR, path.join(DATA_DIR, 'images'), path.join(DATA_DIR, 'videos')]) {
  try { fs.chmodSync(dir, 0o777); } catch {}
}

app.use(express.static(PUBLIC_DIR));
app.use('/images', express.static(path.join(DATA_DIR, 'images')));
app.use('/videos', express.static(path.join(DATA_DIR, 'videos')));

const dbPath = process.env.SQLITE_PATH || path.join(DATA_DIR, 'db.sqlite');
if (fs.existsSync(dbPath)) {
  try { fs.chmodSync(dbPath, 0o666); } catch {}
}
const db = new sqlite3.Database(
  dbPath,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) console.error('SQLite open error:', err.message);
    else console.log(`SQLite open ok: ${dbPath}`);
  }
);

const SHORT_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomShortCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_CHARS[bytes[i] % SHORT_CODE_CHARS.length];
  }
  return code;
}

async function generateUniqueShortCode(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    const code = randomShortCode(6);
    const exists = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM posts WHERE short_code=?', [code], (err, row) => err ? reject(err) : resolve(!!row));
    });
    if (!exists) return code;
  }
  throw new Error('短链生成失败：重试次数超限');
}

async function ensureShortCodeReady() {
  const columns = await new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(posts)', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  if (!columns.some(col => col.name === 'short_code')) {
    await runDbWrite('ALTER TABLE posts ADD COLUMN short_code TEXT');
  }

  await runDbWrite('CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_short_code ON posts(short_code)');

  const missingRows = await new Promise((resolve, reject) => {
    db.all("SELECT id FROM posts WHERE short_code IS NULL OR short_code=''", (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  for (const row of missingRows) {
    const shortCode = await generateUniqueShortCode();
    await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [shortCode, row.id]);
  }
}

db.serialize(() => {
  db.run('PRAGMA query_only = OFF');
  db.get('PRAGMA query_only', (e, row) => {
    if (!e) console.log('SQLite query_only:', row && (row.query_only ?? Object.values(row)[0]));
  });

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    author TEXT,
    author_handle TEXT,
    author_avatar TEXT,
    content TEXT,
    images TEXT,
    video TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tweet_time TEXT,
    html_file TEXT,
    short_code TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    target_lang TEXT NOT NULL,
    source_lang TEXT,
    source_hash TEXT NOT NULL,
    translated_json TEXT NOT NULL,
    provider TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, target_lang, source_hash)
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_translations_post_lang_hash
    ON translations(post_id, target_lang, source_hash)`);
});

function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchFromFxTwitter(tweetId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.fxtwitter.com',
      path: `/status/${tweetId}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const req = https.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(data);
          const json = JSON.parse(buffer.toString('utf8'));
          if (json.code === 200 && json.tweet) resolve(json.tweet);
          else reject(new Error(json.message || 'API错误'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('超时')); });
    req.end();
  });
}

async function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, 'data', 'images', filename);
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(`/images/${filename}`); });
    }).on('error', reject);
  });
}

async function downloadVideo(url, filename) {
  return new Promise((resolve, reject) => {
    const videoDir = path.join(__dirname, 'data', 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    const filePath = path.join(videoDir, filename);
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，状态码: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(`/videos/${filename}`); });
    }).on('error', (err) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      reject(err);
    });
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function extractSummary(content) {
  if (!content) return '';
  return content.replace(/<[^>]+>/g, '').substring(0, 200);
}

function detectContentLanguage(content = '') {
  const text = String(content).replace(/<[^>]+>/g, ' ').trim();
  if (!text) return 'en';
  const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return zhChars > 0 ? 'zh' : 'en';
}

function decodeEntities(text = '') {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function extractTranslatableParts(content = '') {
  const withBreaks = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<img[^>]*>/gi, '\n')
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '\n');

  const plain = decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '));
  return plain
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 60);
}

function sourceHash(parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function translateWithSiliconFlow(parts, targetLang) {
  if (!SILICONFLOW_API_KEY) throw new Error('未配置翻译API Key');

  const langName = targetLang === 'zh-CN' ? '简体中文' : (targetLang === 'en' ? 'English' : targetLang);
  const body = {
    model: SILICONFLOW_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `你是翻译引擎。把输入数组逐项翻译为${langName}，保持语义准确和分段顺序。不要解释，不要增删段落。` 
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'translate_array',
          targetLang,
          parts
        })
      }
    ]
  };

  const response = await fetch(`${SILICONFLOW_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`翻译服务错误(${response.status}): ${errText.slice(0, 180)}`);
  }

  const json = await response.json();
  const rawContent = json?.choices?.[0]?.message?.content;
  const text = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || {});

  let parsed;
  if (rawContent && typeof rawContent === 'object') {
    parsed = rawContent;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }
  }

  let translations = parsed.translations || parsed.result || parsed.parts || parsed['部分'] || parsed['翻译结果'];
  if (!Array.isArray(translations) && parsed && typeof parsed === 'object') {
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) {
        translations = value;
        break;
      }
    }
  }
  if (Array.isArray(translations)) {
    translations = translations.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item.translation === 'string') return item.translation;
      if (item && typeof item.translated === 'string') return item.translated;
      if (item && typeof item.text === 'string') return item.text;
      return '';
    });
  }

  if (!Array.isArray(translations) || translations.length !== parts.length) {
    const raw = String(text || '').trim();
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const maybeArray = JSON.parse(cleaned);
      if (Array.isArray(maybeArray)) {
        translations = maybeArray.map(v => String(v || '').trim());
      }
    } catch {}

    if ((!Array.isArray(translations) || translations.length !== parts.length) && cleaned) {
      const lines = cleaned
        .split(/\n+/)
        .map(s => s.replace(/^\s*\d+[\)\.、\-]\s*/, '').trim())
        .filter(Boolean);

      if (parts.length === 1) {
        translations = [cleaned];
      } else if (lines.length === parts.length) {
        translations = lines;
      }
    }
  }

  if (Array.isArray(translations) && translations.length !== parts.length) {
    translations = parts.map((src, i) => {
      const t = translations[i];
      return String((t == null || t === '') ? src : t).trim();
    });
  }

  if (!Array.isArray(translations) || translations.length !== parts.length) {
    throw new Error('翻译结果格式异常');
  }

  return {
    sourceLang: parsed.sourceLang || 'auto',
    translations: translations.map(t => String(t || '').trim())
  };
}

async function fetchXPost(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('无法提取推文ID');

  const tweet = await fetchFromFxTwitter(tweetId);
  const author = tweet.author || {};
  const media = tweet.media || {};

  const allImageUrls = [];

  if (tweet.article?.cover_media?.media_info?.original_img_url) {
    allImageUrls.push(tweet.article.cover_media.media_info.original_img_url);
  }

  (media.photos || []).forEach(p => { if (p.url) allImageUrls.push(p.url); });

  if (tweet.media_entities) {
    for (const e of tweet.media_entities) {
      if (e.media_info?.original_img_url) allImageUrls.push(e.media_info.original_img_url);
    }
  }

  if (tweet.article?.media_entities) {
    for (const e of tweet.article.media_entities) {
      if (e.media_info?.original_img_url) allImageUrls.push(e.media_info.original_img_url);
    }
  }

  const uniqueUrls = [...new Set(allImageUrls)];

  const localImages = [];
  const urlToLocalPath = new Map();
  for (let i = 0; i < uniqueUrls.length; i++) {
    const ext = uniqueUrls[i].split('.').pop().split('?')[0] || 'jpg';
    const filename = `${tweetId}_${i}.${ext}`;
    try {
      const localPath = await downloadImage(uniqueUrls[i], filename);
      localImages.push(localPath);
      urlToLocalPath.set(uniqueUrls[i], localPath);
    } catch {
      localImages.push(uniqueUrls[i]);
      urlToLocalPath.set(uniqueUrls[i], uniqueUrls[i]);
    }
  }

  let localVideoPath = null;
  const videoUrl = media.videos?.[0]?.url;
  if (videoUrl) {
    const videoExt = videoUrl.split('.').pop().split('?')[0] || 'mp4';
    const videoFilename = `${tweetId}_video.${videoExt}`;
    try {
      localVideoPath = await downloadVideo(videoUrl, videoFilename);
      console.log(`视频下载成功: ${localVideoPath}`);
    } catch (err) {
      console.error(`视频下载失败: ${err.message}`);
      localVideoPath = videoUrl;
    }
  }

  let htmlContent = '';
  let title = '';

  const allMediaEntities = [
    ...(tweet.article?.media_entities || []),
    ...(tweet.media_entities || [])
  ];

  if (tweet.text) {
    htmlContent = escapeHtml(tweet.text).replace(/\n/g, '<br>');

    if (localImages.length > 0) {
      htmlContent += '<br><br>';
      for (const imgPath of localImages) {
        htmlContent += `<img src="${imgPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
      }
    }
  } else if (tweet.article) {
    title = tweet.article.title || '';

    if (tweet.article.content?.blocks) {
      const blocks = tweet.article.content.blocks;
      const entityMapArray = tweet.article.content.entityMap || [];
      const entityMap = {};
      for (const item of entityMapArray) {
        if (item.key !== undefined && item.value !== undefined) {
          entityMap[item.key] = item.value;
        }
      }

      for (const block of blocks) {
        if (block.text) {
          const text = escapeHtml(block.text).replace(/\n/g, '<br>');
          if (block.type === 'header-two') {
            htmlContent += `<h2>${text}</h2>`;
          } else if (block.type === 'ordered-list-item') {
            htmlContent += `<p>1. ${text}</p>`;
          } else if (block.type === 'unordered-list-item') {
            htmlContent += `<p>• ${text}</p>`;
          } else {
            htmlContent += `<p>${text}</p>`;
          }
        }

        if (block.type === 'atomic' && block.entityRanges) {
          for (const range of block.entityRanges) {
            const entity = entityMap[range.key];
            if (entity?.type === 'MEDIA' && entity.data?.mediaItems) {
              for (const item of entity.data.mediaItems) {
                if (item.mediaId) {
                  const mediaEntity = allMediaEntities.find(m => m.media_id === item.mediaId || m.id?.includes(item.mediaId));
                  if (mediaEntity?.media_info?.original_img_url) {
                    const originalUrl = mediaEntity.media_info.original_img_url;
                    const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
                    htmlContent += `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
                  }
                }
              }
            }
          }
        }
      }
    }

    let imgIndex = 0;
    htmlContent = htmlContent.replace(/XIMGPH_\d+/g, () => {
      const mediaEntity = allMediaEntities[imgIndex];
      imgIndex++;
      if (mediaEntity?.media_info?.original_img_url) {
        const originalUrl = mediaEntity.media_info.original_img_url;
        const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
        return `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
      }
      return '';
    });

    if (!htmlContent && tweet.article.preview_text) {
      htmlContent = escapeHtml(tweet.article.preview_text).replace(/\n/g, '<br>');
    }
  }

  if (title) {
    htmlContent = `<h1>【${escapeHtml(title)}】</h1>` + htmlContent;
  }

  return {
    author: author.name || '未知用户',
    author_handle: author.screen_name || 'unknown',
    author_avatar: author.avatar_url || '',
    content: htmlContent,
    images: localImages,
    video: localVideoPath,
    tweet_time: tweet.created_timestamp
  };
}

function generateMirrorHtml(post) {
  const content = post.content || '';
  const videoHtml = post.video ? `<video controls style="max-width:100%;margin:10px 0;"><source src="${post.video}" type="video/mp4"></video>` : '';

  const summary = extractSummary(content);
  const ogImage = post.images && post.images.length > 0 ? post.images[0] : '';
  let articleTitle = '';
  const h1Match = content.match(/<h1[^>]*>(.+?)<\/h1>/i);
  const h2Match = content.match(/<h2[^>]*>(.+?)<\/h2>/i);
  if (h1Match) articleTitle = h1Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else if (h2Match) articleTitle = h2Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else articleTitle = summary.substring(0, 25);
  if (articleTitle.length >= 25) articleTitle += '...';
  const pageTitle = articleTitle ? `${escapeHtml(articleTitle)} | XMirror` : `${escapeHtml(post.author)} | XMirror`;
  const canonicalPath = post.short_code ? `/${post.short_code}` : `/archives/${post.html_file}`;
  const canonicalUrl = `https://xmirror.app${canonicalPath}`;
  const refererPath = post.short_code ? `/${post.short_code}/referer` : post.url;
  const createdAt = post.tweet_time || post.created_at || new Date().toISOString();
  const sourceLang = detectContentLanguage(content);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${escapeHtml(summary)}">
<meta name="keywords" content="X存档,Twitter存档,${escapeHtml(post.author)},推文备份,XMirror">
<meta name="author" content="${escapeHtml(post.author)}">
<meta name="robots" content="index, follow">
<meta name="googlebot" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${escapeHtml(summary)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:site_name" content="XMirror">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="${createdAt}">
<meta property="article:author" content="${escapeHtml(post.author)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${escapeHtml(summary)}">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:creator" content="@${escapeHtml(post.author_handle)}">
<meta name="twitter:domain" content="xmirror.app">
<style>
:root{--bg-color:#ffffff;--text-primary:#0f1419;--text-secondary:#536471;--border-color:#eff3f4;--link-color:#1d9bf0;--hover-bg:rgba(15,20,25,0.1);--card-shadow:0 0 15px rgba(0,0,0,0.08)}
[data-theme="dark"]{--bg-color:#15202b;--text-primary:#e7e9ea;--text-secondary:#8899a6;--border-color:#38444d;--link-color:#1d9bf0;--hover-bg:rgba(255,255,255,0.1);--card-shadow:0 0 15px rgba(0,0,0,0.3)}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg-color);color:var(--text-primary);min-height:100vh;padding:20px;transition:background .3s,color .3s}
.theme-toggle{position:fixed;top:20px;right:20px;width:44px;height:44px;border-radius:50%;border:none;background:var(--hover-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;z-index:100;transition:transform .2s}
.theme-toggle:hover{transform:scale(1.1)}
.container{max-width:600px;margin:30px auto 20px}.post{background:var(--bg-color);border:1px solid var(--border-color);border-radius:16px;padding:20px;box-shadow:var(--card-shadow);transition:border-color .3s}
.header{display:flex;align-items:flex-start;margin-bottom:12px}.avatar{width:48px;height:48px;border-radius:50%;margin-right:12px;object-fit:cover;background:var(--border-color)}
.author-info{flex:1}.author-name{font-weight:700;font-size:16px;color:var(--text-primary);display:flex;align-items:center;gap:4px}.author-handle{color:var(--text-secondary);font-size:15px}
.content{margin:4px 0;font-size:17px;line-height:1.6;word-wrap:break-word;color:var(--text-primary)}
.content h1{font-size:20px;font-weight:800;margin:16px 0}.content h2{font-size:18px;font-weight:700;margin:14px 0}.content p{margin:12px 0}.content a{color:var(--link-color);text-decoration:none}.content a:hover{text-decoration:underline}
.content img,.media-img{max-width:100%;border-radius:16px;margin:12px 0;border:1px solid var(--border-color)}video{max-width:100%;border-radius:16px;margin:12px 0}
.translate-toolbar{display:flex;gap:8px;margin:12px 0;align-items:center;flex-wrap:wrap}
.translate-btn{padding:6px 12px;border:1px solid var(--border-color);border-radius:999px;background:var(--hover-bg);color:var(--text-primary);cursor:pointer;font-size:13px}
.translate-btn[disabled]{opacity:.6;cursor:not-allowed}
.translate-status{font-size:12px;color:var(--text-secondary)}
.content-view{display:none}
.content-view.active{display:block}
.meta{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);color:var(--text-secondary);font-size:14px}
.source{color:var(--link-color);text-decoration:none}.source:hover{text-decoration:underline}.badge{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600}
.time{display:flex;align-items:center;gap:8px}@media(max-width:600px){body{padding:10px}.container{margin:50px 0 10px}.post{border-radius:12px}}
</style>
</head>
<body>
<button class="theme-toggle" onclick="toggleTheme()" title="切换主题">🌓</button>
<div class="container">
<div class="post" data-post-id="${post.id}" data-source-lang="${sourceLang}">
<div class="header">
<img class="avatar" src="${post.author_avatar}" onerror="this.style.display='none'">
<div class="author-info"><div class="author-name">${escapeHtml(post.author)}</div><div class="author-handle">@${escapeHtml(post.author_handle)}</div></div></div>
<div class="translate-toolbar">
<button id="translateBtn" class="translate-btn" onclick="toggleTranslate()">🌐 翻译为中文</button>
<span id="translateStatus" class="translate-status"></span>
</div>
<div id="originContent" class="content content-view active">${content}</div>
<div id="translatedContent" class="content content-view"></div>
${videoHtml}
<div class="meta"><div class="time"><span>${new Date(createdAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span>·</span><a class="source" href="${refererPath}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a></div><span class="badge">🐦 XMirror</span></div>
</div></div>
<script>
function getPreferredTheme(){const saved=localStorage.getItem('xmirror-theme');if(saved)return saved;const hour=new Date().getHours();return(hour>=6&&hour<18)?'light':'dark'}
function applyTheme(theme){document.documentElement.setAttribute('data-theme',theme);localStorage.setItem('xmirror-theme',theme)}
function toggleTheme(){const current=document.documentElement.getAttribute('data-theme');applyTheme(current==='dark'?'light':'dark')}
function showContent(mode){const origin=document.getElementById('originContent');const translated=document.getElementById('translatedContent');if(mode==='translated'){translated.classList.add('active');origin.classList.remove('active')}else{origin.classList.add('active');translated.classList.remove('active')}}
function detectOriginLang(){const text=(document.getElementById('originContent')?.textContent||'').trim();if(!text)return 'en';const zhChars=(text.match(/[\u4e00-\u9fff]/g)||[]).length;return zhChars>0?'zh':'en'}
function getTranslateConfig(){const postEl=document.querySelector('.post');const sourceLangFromServer=postEl?.dataset?.sourceLang;const originLang=(sourceLangFromServer==='zh'||sourceLangFromServer==='en')?sourceLangFromServer:detectOriginLang();const targetLang=originLang==='zh'?'en':'zh-CN';const targetLabel=targetLang==='en'?'英文':'中文';return {originLang,targetLang,targetLabel}}
function setDefaultTranslateButtonText(){const btn=document.getElementById('translateBtn');if(!btn)return;const cfg=getTranslateConfig();btn.textContent='🌐 翻译为'+cfg.targetLabel}
async function toggleTranslate(){const postEl=document.querySelector('.post');const postId=postEl?.dataset?.postId;const btn=document.getElementById('translateBtn');const status=document.getElementById('translateStatus');const translatedEl=document.getElementById('translatedContent');const cfg=getTranslateConfig();const hasTranslated=translatedEl.innerHTML.trim().length>0;const showingTranslated=translatedEl.classList.contains('active');if(!postId)return;
if(hasTranslated){if(showingTranslated){showContent('origin');btn.textContent='🌐 查看'+cfg.targetLabel+'译文';status.textContent=''}else{showContent('translated');btn.textContent='📝 查看原文';status.textContent=''}return;}
btn.disabled=true;status.textContent='翻译中...';try{const res=await fetch('/api/translate/'+postId+'?targetLang='+encodeURIComponent(cfg.targetLang));const data=await res.json();if(!data.success)throw new Error(data.error||'翻译失败');const html=(data.parts||[]).map(p=>'<p>'+String(p).replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p>').join('');translatedEl.innerHTML=html||'<p>暂无译文</p>';showContent('translated');btn.textContent='📝 查看原文';status.textContent=data.cached?'已显示缓存译文':'翻译完成'}catch(e){status.textContent='翻译失败：'+e.message}finally{btn.disabled=false}}
applyTheme(getPreferredTheme());
setDefaultTranslateButtonText();
</script>
</body>
</html>`;

  return html;
}

async function getPostById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM posts WHERE id=?', [id], (err, row) => err ? reject(err) : resolve(row));
  });
}

function healDbWriteability() {
  try { fs.chmodSync(DATA_DIR, 0o777); } catch {}
  try { fs.chmodSync(dbPath, 0o666); } catch {}
  try { db.run('PRAGMA query_only = OFF'); } catch {}
}

function runDbWrite(sql, params = []) {
  return new Promise((resolve, reject) => {
    const writer = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (openErr) => {
      if (openErr) return reject(openErr);

      writer.run('PRAGMA query_only = OFF');
      writer.run(sql, params, function(err) {
        if (!err) {
          const result = { lastID: this.lastID, changes: this.changes };
          return writer.close(() => resolve(result));
        }

        if (!String(err.message || '').includes('SQLITE_READONLY')) {
          return writer.close(() => reject(err));
        }

        healDbWriteability();
        writer.run('PRAGMA query_only = OFF');
        writer.run(sql, params, function(err2) {
          if (err2) return writer.close(() => reject(err2));
          const result2 = { lastID: this.lastID, changes: this.changes };
          writer.close(() => resolve(result2));
        });
      });
    });
  });
}

async function upsertTranslation({ postId, targetLang, sourceLang, sourceHashValue, translations }) {
  const payload = JSON.stringify({ parts: translations });
  await runDbWrite(
    `INSERT INTO translations(post_id,target_lang,source_lang,source_hash,translated_json,provider)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(post_id,target_lang,source_hash)
     DO UPDATE SET translated_json=excluded.translated_json, source_lang=excluded.source_lang, provider=excluded.provider, updated_at=CURRENT_TIMESTAMP`,
    [postId, targetLang, sourceLang, sourceHashValue, payload, TRANSLATE_PROVIDER]
  );
}

app.get('/api/translate/:id', async (req, res) => {
  const postId = Number(req.params.id);
  const targetLang = req.query.targetLang || 'zh-CN';
  if (!postId) return res.status(400).json({ success: false, error: '无效 postId' });

  try {
    const post = await getPostById(postId);
    if (!post) return res.status(404).json({ success: false, error: '存档不存在' });

    const parts = extractTranslatableParts(post.content || '');
    if (!parts.length) return res.status(400).json({ success: false, error: '无可翻译内容' });

    const hash = sourceHash(parts);
    const cached = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM translations WHERE post_id=? AND target_lang=? AND source_hash=?',
        [postId, targetLang, hash],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (cached) {
      let translated = [];
      try {
        translated = JSON.parse(cached.translated_json || '{}').parts || [];
      } catch {}
      if (translated.length === parts.length) {
        return res.json({ success: true, cached: true, sourceLang: cached.source_lang || 'auto', targetLang, parts: translated });
      }
    }

    const result = await translateWithSiliconFlow(parts, targetLang);
    await upsertTranslation({
      postId,
      targetLang,
      sourceLang: result.sourceLang,
      sourceHashValue: hash,
      translations: result.translations
    });

    res.json({ success: true, cached: false, sourceLang: result.sourceLang, targetLang, parts: result.translations });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || '翻译失败' });
  }
});

function getModerationSettings() {
  try {
    if (!fs.existsSync(MODERATION_SETTINGS_PATH)) {
      const defaults = { enabled: true, updated_at: new Date().toISOString() };
      fs.writeFileSync(MODERATION_SETTINGS_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }

    const raw = fs.readFileSync(MODERATION_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      enabled: parsed.enabled !== false,
      updated_at: parsed.updated_at || new Date().toISOString()
    };
  } catch (err) {
    console.warn('读取 moderation settings 失败:', err.message);
    return { enabled: true, updated_at: new Date().toISOString() };
  }
}

function setModerationSettings(nextSettings = {}) {
  const payload = {
    enabled: nextSettings.enabled !== false,
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(MODERATION_SETTINGS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function requireAdmin(req, res, next) {
  if (!MODERATION_ADMIN_TOKEN) {
    return res.status(503).json({ error: '后台未配置 MODERATION_ADMIN_TOKEN' });
  }

  const token = req.get('x-admin-token') || req.query.token || req.body?.token;
  if (token !== MODERATION_ADMIN_TOKEN) {
    return res.status(403).json({ error: '无权限访问后台' });
  }

  return next();
}

function readRecentModerationLogs(limit = 50) {
  try {
    if (!fs.existsSync(MODERATION_LOG_PATH)) return [];
    const lines = fs.readFileSync(MODERATION_LOG_PATH, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    console.warn('读取 moderation logs 失败:', err.message);
    return [];
  }
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('清理文件失败:', filePath, err.message);
  }
}

function cleanupFetchedAssets(content = {}) {
  const imagePaths = Array.isArray(content.images) ? content.images : [];
  for (const imagePath of imagePaths) {
    if (typeof imagePath === 'string' && imagePath.startsWith('/images/')) {
      safeUnlink(path.join(DATA_DIR, imagePath.replace(/^\//, '')));
    }
  }

  if (typeof content.video === 'string' && content.video.startsWith('/videos/')) {
    safeUnlink(path.join(DATA_DIR, content.video.replace(/^\//, '')));
  }
}

async function archiveXUrl(url) {
  const moderationSettings = getModerationSettings();
  if (moderationSettings.enabled) {
    moderator.precheckUrl(url);
  }

  const existing = await new Promise((r, j) => db.get('SELECT * FROM posts WHERE url=?', [url], (e, row) => e ? j(e) : r(row)));
  if (existing) {
    if (!existing.short_code) {
      existing.short_code = await generateUniqueShortCode();
      await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [existing.short_code, existing.id]);
    }
    const htmlPath = path.join(ARCHIVES_DIR, existing.html_file);
    const htmlContent = generateMirrorHtml(existing);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    return { success: true, id: existing.id, url: `/${existing.short_code}`, short_code: existing.short_code, message: '已存在', cached: true };
  }

  const content = await fetchXPost(url);
  if (!content.content && content.images.length === 0 && !content.video) {
    throw new Error('未能获取推文内容');
  }

  if (moderationSettings.enabled) {
    try {
      moderator.moderateArchivedContent({
        url,
        authorHandle: content.author_handle,
        authorName: content.author,
        content: content.content
      });
    } catch (err) {
      if (err instanceof ModerationRejectError) {
        cleanupFetchedAssets(content);
      }
      throw err;
    }
  }

  let title = '';
  const h1Match = content.content.match(/<h1>(.+?)<\/h1>/);
  if (h1Match) {
    title = h1Match[1].replace(/【(.+?)】/, '$1');
  } else {
    title = content.content.replace(/<[^>]+>/g, '').substring(0, 50);
    if (content.content.replace(/<[^>]+>/g, '').length > 50) title += '...';
  }

  const timestamp = Date.now();
  const htmlFile = `post_${timestamp}.html`;
  const shortCode = await generateUniqueShortCode();

  let stmt;
  try {
    stmt = await runDbWrite(
      'INSERT INTO posts(url,author,author_handle,author_avatar,content,images,video,tweet_time,html_file,short_code)VALUES(?,?,?,?,?,?,?,?,?,?)',
      [url, content.author, content.author_handle, content.author_avatar, content.content, JSON.stringify(content.images), content.video, content.tweet_time, htmlFile, shortCode]
    );
  } catch (insertErr) {
    if (String(insertErr.message || '').includes('UNIQUE constraint failed: posts.url')) {
      const existing2 = await new Promise((r, j) => db.get('SELECT * FROM posts WHERE url=?', [url], (e, row) => e ? j(e) : r(row)));
      if (existing2) {
        if (!existing2.short_code) {
          existing2.short_code = await generateUniqueShortCode();
          await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [existing2.short_code, existing2.id]);
        }
        const htmlPath = path.join(ARCHIVES_DIR, existing2.html_file);
        const htmlContent = generateMirrorHtml(existing2);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        return { success: true, id: existing2.id, url: `/${existing2.short_code}`, short_code: existing2.short_code, message: '已存在', cached: true };
      }
    }
    throw insertErr;
  }

  const result = stmt.lastID;
  const htmlContent = generateMirrorHtml({ id: result, url, ...content, html_file: htmlFile, short_code: shortCode });
  fs.writeFileSync(path.join(ARCHIVES_DIR, htmlFile), htmlContent, 'utf8');

  return {
    success: true,
    id: result,
    url: `/${shortCode}`,
    short_code: shortCode,
    message: '存档成功',
    author: content.author,
    title,
    preview: content.content.substring(0, 100)
  };
}

app.post('/api/archive', async (req, res) => {
  const { url } = req.body;
  if (!url?.includes('x.com') && !url?.includes('twitter.com')) {
    return res.status(400).json({ error: '无效的X链接' });
  }

  try {
    const payload = await archiveXUrl(url);
    return res.json(payload);
  } catch (e) {
    const status = e instanceof ModerationRejectError ? 400 : 500;
    return res.status(status).json({ error: e.message || '抓取失败' });
  }
});

app.get('/api/archive/quick', async (req, res) => {
  const rawUrl = (req.query.url || '').toString().trim();
  const format = (req.query.format || 'redirect').toString().toLowerCase();

  if (!rawUrl.includes('x.com') && !rawUrl.includes('twitter.com')) {
    return res.status(400).json({ success: false, error: '无效的X链接' });
  }

  try {
    const payload = await archiveXUrl(rawUrl);
    const absoluteUrl = `${req.protocol}://${req.get('host')}${payload.url}`;

    if (format === 'json') {
      return res.json({ ...payload, absolute_url: absoluteUrl });
    }

    if (format === 'text') {
      return res.type('text/plain; charset=utf-8').send(absoluteUrl);
    }

    return res.redirect(302, absoluteUrl);
  } catch (e) {
    const status = e instanceof ModerationRejectError ? 400 : 500;
    return res.status(status).json({ success: false, error: e.message || '抓取失败' });
  }
});

app.get('/api/posts', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  db.all(
    'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit + 1, offset],
    (e, r) => {
      if (e) return res.status(500).json({ error: e.message });

      const hasMore = (r || []).length > limit;
      const pageRows = (r || []).slice(0, limit).map(post => ({
        ...post,
        short_url: post.short_code ? `/${post.short_code}` : `/archives/${post.html_file}`
      }));

      res.json({
        posts: pageRows,
        limit,
        offset,
        has_more: hasMore
      });
    }
  );
});

app.get('/api/admin/moderation/settings', requireAdmin, (req, res) => {
  return res.json({ success: true, settings: getModerationSettings() });
});

app.post('/api/admin/moderation/settings', requireAdmin, (req, res) => {
  const enabled = req.body?.enabled !== false;
  const settings = setModerationSettings({ enabled });
  return res.json({ success: true, settings });
});

app.get('/api/admin/moderation/logs', requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  return res.json({ success: true, logs: readRecentModerationLogs(limit) });
});

app.post('/api/delete', async (req, res) => {
  const {id} = req.body;
  if (!id) return res.status(400).json({error:'缺少存档ID'});

  try {
    const post = await new Promise((r,j)=>db.get('SELECT * FROM posts WHERE id=?',[id],(e,row)=>e?j(e):r(row)));
    if (!post) return res.status(404).json({error:'存档不存在'});

    const htmlPath = path.join(ARCHIVES_DIR, post.html_file);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);

    let images = [];
    try { images = JSON.parse(post.images || '[]'); } catch {}
    for (const imgPath of images) {
      const imgFullPath = path.join(__dirname, imgPath.replace(/^\//, ''));
      if (fs.existsSync(imgFullPath)) fs.unlinkSync(imgFullPath);
    }

    if (post.video && post.video.startsWith('/videos/')) {
      const videoFullPath = path.join(__dirname, post.video.replace(/^\//, ''));
      if (fs.existsSync(videoFullPath)) fs.unlinkSync(videoFullPath);
    }

    await runDbWrite('DELETE FROM posts WHERE id=?',[id]);
    await runDbWrite('DELETE FROM translations WHERE post_id=?',[id]);

    res.json({success:true,message:'删除成功'});
  } catch(e) {
    res.status(500).json({error:e.message||'删除失败'});
  }
});

app.get('/archives/:fileName', async (req, res, next) => {
  const { fileName } = req.params;
  if (!/^post_\d+\.html$/.test(fileName)) return next();

  try {
    const post = await new Promise((resolve, reject) => {
      db.get('SELECT short_code FROM posts WHERE html_file=?', [fileName], (err, row) => err ? reject(err) : resolve(row));
    });

    if (post?.short_code) {
      return res.redirect(301, `/${post.short_code}`);
    }
  } catch (e) {
    console.error('旧链接301映射失败:', e.message);
  }

  return next();
});

app.use('/archives', express.static(ARCHIVES_DIR));

app.get(/^\/([A-Za-z0-9]{6})\/referer$/, async (req, res, next) => {
  try {
    const shortCode = req.params[0];
    const post = await new Promise((resolve, reject) => {
      db.get('SELECT url FROM posts WHERE short_code=?', [shortCode], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!post?.url) return next();

    return res.redirect(302, post.url);
  } catch (e) {
    console.error('中转链接跳转失败:', e.message);
    return next();
  }
});

app.get(/^\/([A-Za-z0-9]{6})$/, async (req, res, next) => {
  try {
    const shortCode = req.params[0];
    const post = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM posts WHERE short_code=?', [shortCode], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!post) return next();

    const htmlContent = generateMirrorHtml(post);
    return res.status(200).send(htmlContent);
  } catch (e) {
    console.error('短链访问失败:', e.message);
    return next();
  }
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

async function startServer() {
  try {
    await ensureShortCodeReady();
    console.log('短链字段与历史数据检查完成');
  } catch (e) {
    console.error('短链初始化失败:', e.message);
    process.exit(1);
  }

  app.listen(PORT,'0.0.0.0',()=>{
    console.log(`XMirror运行在http://0.0.0.0:${PORT}`);
    console.log(`SQLite: ${dbPath}`);
  });
}

startServer();