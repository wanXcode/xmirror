const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { version: APP_VERSION } = require('./package.json');
const seo = require('./lib/seo');
const { prepareContent, structuredData } = require('./lib/seo-content');
const { migrateReports, registerReportRoutes } = require('./lib/content-reports');
const { createSeoStore } = require('./lib/seo-store');
const { registerSeoRoutes } = require('./lib/seo-routes');
const {
  transcribeVideo,
  segmentsToVtt
} = require('./lib/subtitles');
const { createModerator, ModerationRejectError } = require('./lib/moderation');
const { createReviewService, groupLogs } = require('./lib/moderation-review');
const { createChatCompletion } = require('./lib/siliconflow');
const {
  normalizeTargetLanguage,
  TranslationFormatError,
  detectContentLanguage,
  extractTranslatableBlocks,
  sourceHash: translationSourceHash,
  translateInBatches,
  createRateLimiter,
  translationErrorResponse
} = require('./lib/translation');
const {
  STRATEGY_VERSION: TRANSLATION_STRATEGY_VERSION,
  MAX_TRANSLATABLE_CHARS,
  MAX_TRANSLATABLE_SEGMENTS,
  totalCharacters,
  jobKey: buildTranslationJobKey,
  nextBatch: nextTranslationBatch,
  progress: translationProgress
} = require('./lib/translation-jobs');
const {
  extractXPostId,
  isBrokenArticleArchive,
  normalizeXTimestamp,
  renderTweetContent
} = require('./lib/x-post');
const { normalizePublicBaseUrl, buildPublicUrl } = require('./lib/public-url');
const { createAdminGuard } = require('./lib/admin-auth');
const { ArchiveError, normalizeArchiveUrl, archiveErrorResponse, archiveSuccessResponse } = require('./lib/archive-response');
const { registerHealthRoute } = require('./lib/health');
const { createFetcher } = require('./lib/fetchers');
const { resolveUrl, isSensitiveTweet } = require('./lib/resolve');
const { clientIpMiddleware, DEFAULT_TRUST_PROXY } = require('./lib/client-ip');
const { downloadImage: downloadImageFile, imageExtension, isTwimgUrl } = require('./lib/media-download');
const {
  deleteMediaAsset,
  deleteMediaAssetBestEffort
} = require('./lib/media-assets');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);

const TRANSLATE_PROVIDER = process.env.TRANSLATE_PROVIDER || 'siliconflow';
const SILICONFLOW_BASE_URL = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '');
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'tencent/Hunyuan-MT-7B';
const SILICONFLOW_FALLBACK_MODELS = (process.env.SILICONFLOW_FALLBACK_MODELS || 'Qwen/Qwen2.5-7B-Instruct,THUDM/GLM-4-9B-0414')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean);
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY || '';
const SILICONFLOW_TRANSCRIPTION_MODEL = process.env.SILICONFLOW_TRANSCRIPTION_MODEL || 'FunAudioLLM/SenseVoiceSmall';
const SUBTITLE_SEGMENT_SECONDS = Math.max(5, Number(process.env.SUBTITLE_SEGMENT_SECONDS) || 12);
const SUBTITLE_TRANSCRIPTION_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SUBTITLE_TRANSCRIPTION_CONCURRENCY) || 3));
const SUBTITLE_CONCURRENCY = Math.max(1, Number(process.env.SUBTITLE_CONCURRENCY) || 2);
const MODERATION_ADMIN_TOKEN = process.env.MODERATION_ADMIN_TOKEN || '';
const requireAdmin = createAdminGuard(MODERATION_ADMIN_TOKEN);
const TRANSLATION_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.TRANSLATION_CONCURRENCY) || 2));
const TRANSLATION_BATCH_RETRIES = 3;
const translationQueue = [];
const translationQueued = new Set();
const translationRunning = new Set();
let activeTranslationJobs = 0;

// Cloudflare -> nginx -> node: trust the local proxy hop and prefer the
// visitor address Cloudflare reports, so rate limits are per visitor.
app.set('trust proxy', process.env.TRUST_PROXY || DEFAULT_TRUST_PROXY);
app.use(clientIpMiddleware);
app.use(express.json());
registerHealthRoute(app);

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const ARCHIVES_DIR = process.env.ARCHIVES_DIR || path.join(ROOT_DIR, 'archives');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const moderator = createModerator({
  rulesPath: path.join(ROOT_DIR, 'config', 'moderation-rules.json'),
  logPath: path.join(DATA_DIR, 'moderation.log.jsonl')
});
const seoModerator = createModerator({
  rulesPath: path.join(ROOT_DIR, 'config', 'moderation-rules.json'),
  logPath: null
});
const MODERATION_SETTINGS_PATH = path.join(DATA_DIR, 'moderation-settings.json');
const MODERATION_LOG_PATH = path.join(DATA_DIR, 'moderation.log.jsonl');
const reviewService = createReviewService({ moderator, dataDir: DATA_DIR, logPath: MODERATION_LOG_PATH });


fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'videos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'subtitles'), { recursive: true });

for (const dir of [DATA_DIR, ARCHIVES_DIR, path.join(DATA_DIR, 'images'), path.join(DATA_DIR, 'videos'), path.join(DATA_DIR, 'subtitles')]) {
  try { fs.chmodSync(dir, 0o750); } catch {}
}

// Keep the document shell fresh so it can point browsers at the current
// versioned assets. The assets themselves are cacheable because their query
// string changes with each release.
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});


const dbPath = process.env.SQLITE_PATH || path.join(DATA_DIR, 'db.sqlite');
if (fs.existsSync(dbPath)) {
  try { fs.chmodSync(dbPath, 0o640); } catch {}
}
const db = new sqlite3.Database(
  dbPath,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) console.error('SQLite open error:', err.message);
    else console.log(`SQLite open ok: ${dbPath}`);
  }
);

db.configure('busyTimeout', 10000);
const seoReviewService = createReviewService({ moderator: seoModerator, dataDir: DATA_DIR, logPath: MODERATION_LOG_PATH });
const seoStore = createSeoStore(db, { dataDir: DATA_DIR, moderator: seoModerator, reviewService: seoReviewService, autoIndex: process.env.SEO_AUTO_INDEX !== 'false' });
const seoAI = require('./lib/seo-ai').createSeoAI({ store: seoStore, dataDir: DATA_DIR, isBusy: () => activeTranslationJobs > 0 });
seoStore.onEvaluated(post => seoAI.enqueue(post));
registerSeoRoutes(app, { store: seoStore, ai: seoAI, publicDir: PUBLIC_DIR, baseUrl: PUBLIC_BASE_URL, requireAdmin });
registerReportRoutes(app, { store: seoStore, publicDir: PUBLIC_DIR, baseUrl: PUBLIC_BASE_URL, requireAdmin });
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
app.use('/images', express.static(path.join(DATA_DIR, 'images')));
app.use('/videos', express.static(path.join(DATA_DIR, 'videos')));
app.use('/subtitles', express.static(path.join(DATA_DIR, 'subtitles')));

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
      db.get(
        `SELECT 1 FROM posts WHERE short_code=?
         UNION ALL SELECT 1 FROM post_aliases WHERE alias_code=? LIMIT 1`,
        [code, code],
        (err, row) => err ? reject(err) : resolve(!!row)
      );
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

async function ensureVideoColumnsReady() {
  const columns = await new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(posts)', (err, rows) => err ? reject(err) : resolve(rows || []));
  });
  const definitions = [
    ['video_status', "TEXT DEFAULT 'none'"],
    ['video_source_url', 'TEXT'],
    ['video_filename', 'TEXT'],
    ['video_bytes', 'INTEGER DEFAULT 0'],
    ['video_total_bytes', 'INTEGER DEFAULT 0'],
    ['video_error', 'TEXT'],
    ['video_is_gif', 'INTEGER DEFAULT 0'],
    ['extra_videos', 'TEXT']
  ];
  for (const [name, definition] of definitions) {
    if (!columns.some(column => column.name === name)) {
      await runDbWrite(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    }
  }

  // Older releases stored an X video URL in `video` after a failed download.
  // Move it to the resumable queue instead of serving it to the browser.
  await runDbWrite(`UPDATE posts
    SET video_source_url=video,
        video_filename=COALESCE(video_filename, 'legacy_' || id || '_video.mp4'),
        video=NULL,
        video_status='queued',
        video_bytes=0,
        video_total_bytes=0,
        video_error=NULL
    WHERE video LIKE 'https://video.twimg.com/%'
      AND (video_source_url IS NULL OR video_source_url='')`);
  await runDbWrite(`UPDATE posts SET video_status='completed'
    WHERE video LIKE '/videos/%' AND (video_status IS NULL OR video_status='none')`);
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

  db.run(`CREATE TABLE IF NOT EXISTS translation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_key TEXT NOT NULL UNIQUE,
    post_id INTEGER NOT NULL,
    target_lang TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    total_segments INTEGER NOT NULL DEFAULT 0,
    completed_segments INTEGER NOT NULL DEFAULT 0,
    failed_segments INTEGER NOT NULL DEFAULT 0,
    source_lang TEXT,
    last_error TEXT,
    lease_token TEXT,
    lease_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_translation_jobs_post
    ON translation_jobs(post_id, target_lang, source_hash)`);
  db.run(`CREATE TABLE IF NOT EXISTS translation_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, segment_index)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_translation_segments_job
    ON translation_segments(job_id, segment_index)`);

  db.run(`CREATE TABLE IF NOT EXISTS subtitle_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'none',
    progress INTEGER NOT NULL DEFAULT 0,
    covered_until REAL NOT NULL DEFAULT 0,
    source_segments TEXT,
    vtt_path TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, lang)
  )`);
  db.run('ALTER TABLE subtitle_tracks ADD COLUMN covered_until REAL NOT NULL DEFAULT 0', () => {});

  db.run(`CREATE INDEX IF NOT EXISTS idx_subtitle_tracks_post
    ON subtitle_tracks(post_id, lang)`);

  db.run(`CREATE TABLE IF NOT EXISTS post_aliases (
    alias_code TEXT PRIMARY KEY,
    target_post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_post_aliases_target
    ON post_aliases(target_post_id)`);
});

const fetchTweet = createFetcher();

function extractTweetId(url) {
  return extractXPostId(url);
}

function downloadImage(url, filename) {
  return downloadImageFile(url, { dir: path.join(DATA_DIR, 'images'), filename });
}

const VIDEO_DOWNLOAD_CONCURRENCY = Math.max(1, Number(process.env.VIDEO_DOWNLOAD_CONCURRENCY) || 1);
const videoQueue = [];
const videoJobs = new Set();
let activeVideoDownloads = 0;

function videoPathForFilename(filename) {
  return path.join(DATA_DIR, 'videos', filename);
}

async function updateVideoRow(postId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return Promise.resolve();
  const values = keys.map(key => fields[key]);
  await runDbWrite(
    `UPDATE posts SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`,
    [...values, postId]
  );
  if (fields.video_status) {
    await seoStore.invalidate(postId);
    await refreshSeo(postId);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function downloadVideoWithProgress(url, filename, onProgress) {
  return new Promise((resolve, reject) => {
    if (!isTwimgUrl(url)) return reject(new Error('视频来源不在允许范围内'));
    const videoDir = path.join(DATA_DIR, 'videos');
    fs.mkdirSync(videoDir, { recursive: true });
    const filePath = videoPathForFilename(filename);
    const tempPath = `${filePath}.part`;
    const request = https.get(url, { headers: { 'User-Agent': 'XMirror/1.0' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return downloadVideoWithProgress(response.headers.location, filename, onProgress).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`下载失败，状态码: ${response.statusCode}`));
      }

      const total = Number(response.headers['content-length']) || 0;
      let downloaded = 0;
      const file = fs.createWriteStream(tempPath);
      const report = () => onProgress?.(downloaded, total);
      response.on('data', chunk => {
        downloaded += chunk.length;
        report();
      });
      response.on('error', err => {
        file.destroy();
        reject(err);
      });
      file.on('error', reject);
      file.on('finish', () => {
        file.close(err => {
          if (err) return reject(err);
          try {
            fs.renameSync(tempPath, filePath);
            report();
            resolve({ path: `/videos/${filename}`, bytes: downloaded, total });
          } catch (renameError) {
            reject(renameError);
          }
        });
      });
      response.pipe(file);
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('视频下载连接超时')));
  }).catch(err => {
    const tempPath = `${videoPathForFilename(filename)}.part`;
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw err;
  });
}

async function updateExtraVideo(postId, filename, fields) {
  const post = await getPostById(postId);
  let extras;
  try { extras = JSON.parse(post?.extra_videos || '[]'); } catch { extras = []; }
  const item = extras.find(entry => entry.filename === filename);
  if (!item) return;
  Object.assign(item, fields);
  await runDbWrite('UPDATE posts SET extra_videos=? WHERE id=?', [JSON.stringify(extras), postId]);
}

async function downloadExtraVideos(postId) {
  const post = await getPostById(postId);
  let extras;
  try { extras = JSON.parse(post?.extra_videos || '[]'); } catch { extras = []; }
  for (const item of extras.filter(entry => entry.status === 'queued')) {
    try {
      const result = await downloadVideoWithProgress(item.source_url, item.filename, () => {});
      await updateExtraVideo(postId, item.filename, { status: 'completed', path: result.path });
    } catch (err) {
      console.error(`附加视频下载失败: ${err.message}`);
      await updateExtraVideo(postId, item.filename, { status: 'failed' });
    }
  }
}

async function processVideoJob(job) {
  const { postId, url, filename, extrasOnly } = job;
  let lastReportedAt = 0;
  try {
    if (!extrasOnly) {
      await updateVideoRow(postId, { video_status: 'downloading', video_error: null });
      const result = await downloadVideoWithProgress(url, filename, async (bytes, total) => {
        const now = Date.now();
        if (bytes !== total && now - lastReportedAt < 500) return;
        lastReportedAt = now;
        await updateVideoRow(postId, { video_bytes: bytes, video_total_bytes: total });
      });
      await updateVideoRow(postId, {
        video: result.path,
        video_status: 'completed',
        video_bytes: result.bytes,
        video_total_bytes: result.total || result.bytes,
        video_error: null
      });
      console.log(`视频下载成功: ${result.path}`);
    }
  } catch (err) {
    console.error(`视频下载失败: ${err.message}`);
    await updateVideoRow(postId, { video_status: 'failed', video_error: err.message || '视频下载失败' });
    return;
  }
  await downloadExtraVideos(postId).catch(err => console.error('附加视频任务失败:', err.message));
}

function pumpVideoQueue() {
  while (activeVideoDownloads < VIDEO_DOWNLOAD_CONCURRENCY && videoQueue.length) {
    const job = videoQueue.shift();
    activeVideoDownloads += 1;
    processVideoJob(job)
      .catch(err => console.error('视频任务处理失败:', err.message))
      .finally(() => {
        activeVideoDownloads -= 1;
        videoJobs.delete(job.postId);
        pumpVideoQueue();
      });
  }
}

function queueVideoDownload({ postId, url, filename, extrasOnly = false }) {
  if (!postId || !url || !filename || videoJobs.has(postId)) return false;
  videoJobs.add(postId);
  videoQueue.push({ postId, url, filename, extrasOnly });
  pumpVideoQueue();
  return true;
}

function queuePendingVideoDownloads() {
  db.all(
    `SELECT id, video_source_url, video_filename FROM posts
     WHERE video_source_url IS NOT NULL AND video_source_url != ''
       AND video_status IN ('queued','downloading')`,
    [],
    (err, rows) => {
      if (err) return console.error('恢复视频下载任务失败:', err.message);
      for (const row of rows || []) {
        queueVideoDownload({ postId: row.id, url: row.video_source_url, filename: row.video_filename });
      }
    }
  );
  // Primary video finished but the extra videos were interrupted by a restart.
  db.all(
    `SELECT id, video_source_url, video_filename FROM posts
     WHERE video_status='completed' AND extra_videos LIKE '%"status":"queued"%'`,
    [],
    (err, rows) => {
      if (err) return console.error('恢复附加视频任务失败:', err.message);
      for (const row of rows || []) {
        queueVideoDownload({ postId: row.id, url: row.video_source_url || 'extras', filename: row.video_filename || 'extras', extrasOnly: true });
      }
    }
  );
}

async function resumeVideoDownloadIfNeeded(post) {
  if (!post?.video_source_url || !post.video_filename) return;
  if (post.video_status === 'failed') {
    await updateVideoRow(post.id, { video_status: 'queued', video_bytes: 0, video_total_bytes: 0, video_error: null });
    post.video_status = 'queued';
  }
  if (['queued', 'downloading'].includes(post.video_status)) {
    queueVideoDownload({ postId: post.id, url: post.video_source_url, filename: post.video_filename });
  } else if (post.video_status === 'completed' && /"status":"(?:queued|failed)"/.test(post.extra_videos || '')) {
    await runDbWrite('UPDATE posts SET extra_videos=REPLACE(extra_videos, \'"status":"failed"\', \'"status":"queued"\') WHERE id=?', [post.id]);
    queueVideoDownload({ postId: post.id, url: post.video_source_url, filename: post.video_filename, extrasOnly: true });
  }
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

async function translateWithSiliconFlow(parts, targetLang, attempt = null) {
  if (!SILICONFLOW_API_KEY) throw new Error('未配置翻译API Key');

  const langName = targetLang === 'zh-CN' ? '简体中文' : (targetLang === 'en' ? 'English' : targetLang);
  const body = {
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

  const models = [...new Set([SILICONFLOW_MODEL, ...SILICONFLOW_FALLBACK_MODELS])];
  const { json } = await createChatCompletion({
    baseUrl: SILICONFLOW_BASE_URL,
    apiKey: SILICONFLOW_API_KEY,
    models: attempt === null ? models : [models[Math.min(attempt, models.length - 1)]],
    body
  });
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

  const looksLikeStructuredResponse = value => {
    const normalized = String(value || '').trim();
    return !normalized || /^\s*[\[{]/.test(normalized) || /[\]}]\s*$/.test(normalized)
      || /(?:^|[\s"'])(?:task|targetLang|parts|translations|翻译数组|目标语言|部分)(?:\s*["']?\s*:)/i.test(normalized);
  };
  if (Array.isArray(translations) && translations.some(looksLikeStructuredResponse)) {
    translations = null;
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
      if (Array.isArray(maybeArray) && !maybeArray.some(looksLikeStructuredResponse)) {
        translations = maybeArray.map(v => String(v || '').trim());
      }
    } catch {}

    if ((!Array.isArray(translations) || translations.length !== parts.length) && cleaned) {
      const lines = cleaned
        .split(/\n+/)
        .map(s => s.replace(/^\s*\d+[\)\.、\-]\s*/, '').trim())
        .filter(Boolean);

      if (parts.length === 1 && !looksLikeStructuredResponse(cleaned)) {
        translations = [cleaned];
      } else if (lines.length === parts.length && !lines.some(looksLikeStructuredResponse)) {
        translations = lines;
      }
    }
  }

  if (!Array.isArray(translations) || translations.length !== parts.length) {
    throw new TranslationFormatError();
  }

  return {
    sourceLang: parsed.sourceLang || 'auto',
    translations: translations.map(t => String(t || '').trim())
  };
}

const SUBTITLE_LANGUAGES = Object.freeze({ en: 'English', 'zh-CN': '简体中文' });
const subtitleQueue = [];
const subtitleJobs = new Set();
const activeSubtitlePosts = new Set();
let activeSubtitleJobs = 0;

function normalizeSubtitleLanguage(value) {
  return Object.hasOwn(SUBTITLE_LANGUAGES, value) ? value : null;
}

function getSubtitleTrack(postId, lang) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM subtitle_tracks WHERE post_id=? AND lang=?', [postId, lang], (err, row) => err ? reject(err) : resolve(row));
  });
}

function getSubtitleTracks(postId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM subtitle_tracks WHERE post_id=? ORDER BY lang', [postId], (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function updateSubtitleTrack(postId, lang, fields) {
  const keys = Object.keys(fields);
  const values = keys.map(key => fields[key]);
  return runDbWrite(
    `INSERT INTO subtitle_tracks(post_id,lang,${keys.join(',')}) VALUES(?,?,${keys.map(() => '?').join(',')})
     ON CONFLICT(post_id,lang) DO UPDATE SET ${keys.map(key => `${key}=excluded.${key}`).join(',')}, updated_at=CURRENT_TIMESTAMP`,
    [postId, lang, ...values]
  );
}

function subtitleFilePath(postId, lang) {
  return path.join(DATA_DIR, 'subtitles', `${postId}_${lang}.vtt`);
}

async function writeSubtitleFile(postId, lang, vtt) {
  const target = subtitleFilePath(postId, lang);
  const temp = `${target}.part`;
  await fs.promises.writeFile(temp, vtt, 'utf8');
  await fs.promises.rename(temp, target);
  return `/subtitles/${postId}_${lang}.vtt`;
}

async function ensureEnglishSubtitles(post, progressStart = 0, progressScale = 100, { onSegment } = {}) {
  let track = await getSubtitleTrack(post.id, 'en');
  let segments;
  try { segments = JSON.parse(track?.source_segments || 'null'); } catch { segments = null; }
  if (!Array.isArray(segments) || !segments.length) {
    await updateSubtitleTrack(post.id, 'en', { status: 'transcribing', progress: progressStart, error: null });
    segments = await transcribeVideo(path.join(DATA_DIR, post.video), {
      apiKey: SILICONFLOW_API_KEY,
      baseUrl: SILICONFLOW_BASE_URL,
      model: SILICONFLOW_TRANSCRIPTION_MODEL,
      segmentSeconds: SUBTITLE_SEGMENT_SECONDS,
      concurrency: SUBTITLE_TRANSCRIPTION_CONCURRENCY,
      onSegment: async (segment, index, total) => {
        const existing = Array.isArray(segments) ? segments : [];
        existing[index] = segment;
        segments = existing.filter(Boolean);
        const vttPath = await writeSubtitleFile(post.id, 'en', segmentsToVtt(segments));
        const coveredUntil = Math.max(...segments.map(item => Number(item.end) || 0));
        await updateSubtitleTrack(post.id, 'en', {
          status: 'partial',
          progress: Math.round(progressStart + ((index + 1) / total) * progressScale),
          covered_until: coveredUntil,
          source_segments: JSON.stringify(segments),
          vtt_path: vttPath,
          error: null
        });
        await onSegment?.(segment, index, total);
      },
      onProgress: value => updateSubtitleTrack(post.id, 'en', {
        status: Array.isArray(segments) && segments.length ? 'partial' : 'transcribing',
        progress: Math.round(progressStart + (value / 100) * progressScale), error: null
      }).catch(() => {})
    });
    if (!segments.length) throw new Error('未识别到语音内容');
  }
  const vttPath = await writeSubtitleFile(post.id, 'en', segmentsToVtt(segments));
  await updateSubtitleTrack(post.id, 'en', {
    status: 'completed', progress: 100, source_segments: JSON.stringify(segments), vtt_path: vttPath, error: null
  });
  return segments;
}

async function processSubtitleJob({ postId, lang }) {
  const post = await getPostById(postId);
  if (!post || post.video_status !== 'completed' || !post.video) {
    throw new Error('视频尚未下载完成');
  }
  const translatedSegments = [];
  const segments = await ensureEnglishSubtitles(post, 0, lang === 'en' ? 100 : 60, {
    onSegment: lang === 'zh-CN' ? async (segment, index, total) => {
      const result = await translateInBatches([segment.text], batch => translateWithSiliconFlow(batch, lang));
      translatedSegments[index] = { ...segment, text: result.translations[0] };
      const vttPath = await writeSubtitleFile(postId, lang, segmentsToVtt(translatedSegments.filter(Boolean)));
      await updateSubtitleTrack(postId, lang, {
        status: 'partial',
        progress: 60 + Math.round(((index + 1) / total) * 40),
        covered_until: Math.max(...translatedSegments.filter(Boolean).map(item => Number(item.end) || 0)),
        vtt_path: vttPath,
        error: null
      });
    } : undefined
  });
  if (lang === 'en') return;

  if (translatedSegments.length) {
    const vttPath = await writeSubtitleFile(postId, lang, segmentsToVtt(translatedSegments.filter(Boolean)));
    await updateSubtitleTrack(postId, lang, { status: 'completed', progress: 100, vtt_path: vttPath, error: null });
    return;
  }

  await updateSubtitleTrack(postId, lang, { status: 'translating', progress: 60, error: null });
  const result = await translateInBatches(
    segments.map(segment => segment.text),
    batch => translateWithSiliconFlow(batch, lang)
  );
  const fallbackTranslatedSegments = segments.map((segment, index) => ({ ...segment, text: result.translations[index] }));
  const vttPath = await writeSubtitleFile(postId, lang, segmentsToVtt(fallbackTranslatedSegments));
  await updateSubtitleTrack(postId, lang, {
    status: 'completed', progress: 100, vtt_path: vttPath, error: null
  });
}

function pumpSubtitleQueue() {
  while (activeSubtitleJobs < SUBTITLE_CONCURRENCY && subtitleQueue.length) {
    const nextIndex = subtitleQueue.findIndex(job => !activeSubtitlePosts.has(job.postId));
    if (nextIndex < 0) break;
    const [job] = subtitleQueue.splice(nextIndex, 1);
    activeSubtitlePosts.add(job.postId);
    activeSubtitleJobs += 1;
    processSubtitleJob(job)
      .catch(async err => {
        console.error(`字幕生成失败 (${job.postId}/${job.lang}): ${err.message}`);
        await updateSubtitleTrack(job.postId, job.lang, { status: 'failed', error: err.message || '字幕生成失败' }).catch(() => {});
      })
      .finally(() => {
        activeSubtitleJobs -= 1;
        activeSubtitlePosts.delete(job.postId);
        subtitleJobs.delete(`${job.postId}:${job.lang}`);
        pumpSubtitleQueue();
      });
  }
}

async function queueSubtitleJob(postId, lang) {
  const key = `${postId}:${lang}`;
  if (subtitleJobs.has(key)) return false;
  const current = await getSubtitleTrack(postId, lang);
  if (current?.status === 'completed') return false;
  await updateSubtitleTrack(postId, lang, { status: 'queued', progress: 0, error: null });
  subtitleJobs.add(key);
  subtitleQueue.push({ postId, lang });
  pumpSubtitleQueue();
  return true;
}

function queuePendingSubtitleJobs() {
  db.all("SELECT post_id,lang FROM subtitle_tracks WHERE status IN ('queued','transcribing','translating')", [], (err, rows) => {
    if (err) return console.error('恢复字幕任务失败:', err.message);
    for (const row of rows || []) queueSubtitleJob(row.post_id, row.lang).catch(error => console.error('恢复字幕任务失败:', error.message));
  });
}

const MAX_EXTRA_VIDEOS = 4;

function extraVideoFilename(tweetId, index, variantUrl) {
  return `${tweetId}_video_${index + 1}.mp4`;
}

async function fetchXPost(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('无法提取推文ID');

  const tweet = await fetchTweet(tweetId);

  // X 平台官方成人内容标记检测（含被引用推文）
  if (isSensitiveTweet(tweet)) {
    throw new ModerationRejectError("该推文被 X 平台标记为成人内容，无法存档", {
      stage: "x_platform_flag",
      url,
      tweetId,
      possibly_sensitive: true
    });
  }
  const author = tweet.author || {};

  const allImageUrls = [];

  if (tweet.article?.cover_media?.media_info?.original_img_url) {
    allImageUrls.push(tweet.article.cover_media.media_info.original_img_url);
  }

  tweet.photos.forEach(p => { if (p.url) allImageUrls.push(p.url); });

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
    const filename = `${tweetId}_${i}.${imageExtension(uniqueUrls[i])}`;
    try {
      const localPath = await downloadImage(uniqueUrls[i], filename);
      localImages.push(localPath);
      urlToLocalPath.set(uniqueUrls[i], localPath);
    } catch {
      localImages.push(uniqueUrls[i]);
      urlToLocalPath.set(uniqueUrls[i], uniqueUrls[i]);
    }
  }

  // The first video (or GIF) is the primary one and keeps using the existing
  // single-video columns; further ones are downloaded after it.
  let videoSourceUrl = null;
  let videoFilename = null;
  let videoStatus = 'none';
  let videoIsGif = 0;
  const [primary, ...others] = tweet.videos;
  if (primary) {
    videoSourceUrl = primary.variants[0].url;
    videoFilename = `${tweetId}_video.mp4`;
    videoStatus = 'queued';
    videoIsGif = primary.type === 'gif' ? 1 : 0;
  }
  const extraVideos = others.slice(0, MAX_EXTRA_VIDEOS).map((video, index) => ({
    type: video.type,
    source_url: video.variants[0].url,
    filename: extraVideoFilename(tweetId, index),
    path: null,
    status: 'queued'
  }));

  const { htmlContent } = renderTweetContent({ tweet, localImages, urlToLocalPath, escapeHtml });

  return {
    author: author.name || '未知用户',
    author_handle: author.screen_name || 'unknown',
    author_avatar: author.avatar_url || '',
    content: htmlContent,
    images: localImages,
    video: null,
    video_source_url: videoSourceUrl,
    video_filename: videoFilename,
    video_status: videoStatus,
    video_is_gif: videoIsGif,
    extra_videos: extraVideos.length ? JSON.stringify(extraVideos) : null,
    video_bytes: 0,
    video_total_bytes: 0,
    video_error: null,
    tweet_time: normalizeXTimestamp(tweet.created_at, null)
  };
}

function generateMirrorHtml(post) {
  const prepared = prepareContent(post, DATA_DIR);
  const content = prepared.html;
  const videoStatus = post.video_status || (post.video ? 'completed' : (post.video_source_url ? 'queued' : 'none'));
  const videoBytes = Number(post.video_bytes) || 0;
  const videoTotal = Number(post.video_total_bytes) || 0;
  const videoPercent = videoTotal > 0 ? Math.min(100, Math.round((videoBytes / videoTotal) * 100)) : 0;
  let videoHtml = '';
  if (videoStatus === 'completed' && /^\/videos\/[A-Za-z0-9_.-]+$/.test(post.video || '')) {
    videoHtml = buildVideoPlayerHtml(post);
  } else if (['queued', 'downloading'].includes(videoStatus)) {
    const initialText = videoStatus === 'downloading' ? '视频正在下载中…' : '视频即将开始下载…';
    videoHtml = `<div class="video-placeholder" data-video-status="${videoStatus}" data-video-post-id="${post.id}" role="status" aria-live="polite">
      <div class="video-placeholder-title">🎞️ ${initialText}</div>
      <div class="video-progress"><div class="video-progress-bar" style="width:${videoPercent}%"></div></div>
      <div class="video-progress-text">${videoPercent > 0 ? `${videoPercent}% · ${formatBytes(videoBytes)}${videoTotal ? ` / ${formatBytes(videoTotal)}` : ''}` : '正在准备下载'}</div>
    </div>`;
  } else if (videoStatus === 'failed') {
    videoHtml = `<div class="video-placeholder video-placeholder-error" data-video-status="failed" data-video-post-id="${post.id}" role="status">视频下载失败，请重新提交原链接重试。</div>`;
  }

  videoHtml += buildExtraVideosHtml(post);

  const meta = seo.metadata(post);
  const summary = meta.description;
  const ogPath = seo.imagesFor(post).find(image => {
    try { return fs.statSync(path.join(DATA_DIR, image)).size > 0; } catch { return false; }
  });
  const ogImage = buildPublicUrl(ogPath || '/xput-share.png', PUBLIC_BASE_URL);
  const pageTitle = `${escapeHtml(meta.title)} | XPut`;
  const canonicalPath = post.short_code ? `/${post.short_code}` : `/archives/${post.html_file}`;
  const canonicalUrl = buildPublicUrl(canonicalPath, PUBLIC_BASE_URL);
  const refererPath = post.short_code ? `/${post.short_code}/referer` : post.url;
  const publishedAt = normalizeXTimestamp(post.tweet_time, null);
  const savedAt = post.created_at ? (post.created_at.includes("T") ? post.created_at : post.created_at.replace(" ", "T") + "Z") : new Date().toISOString();
  const createdAt = normalizeXTimestamp(savedAt);
  const sourceLang = detectContentLanguage(content);

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(sourceLang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${escapeHtml(summary)}">

<meta name="author" content="${escapeHtml(post.author)}">
<meta name="robots" content="${seo.robotsFor(post)}">

<link rel="canonical" href="${canonicalUrl}">
<link rel="icon" href="/favicon.ico?v=xput-tray-1" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg?v=xput-tray-1" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=xput-tray-1">
<link rel="mask-icon" href="/safari-pinned-tab.svg?v=xput-tray-1" color="#2563eb">
<link rel="manifest" href="/site.webmanifest?v=xput-tray-1">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${escapeHtml(summary)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:site_name" content="XPut">
<meta property="og:locale" content="${({en:'en_US',zh:'zh_CN','zh-CN':'zh_CN',ja:'ja_JP',ko:'ko_KR'})[sourceLang] || 'en_US'}">
${publishedAt ? `<meta property="article:published_time" content="${publishedAt}">` : ''}
<meta property="article:author" content="${escapeHtml(post.author)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${escapeHtml(summary)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:creator" content="@${escapeHtml(post.author_handle)}">
<script type="application/ld+json">${structuredData(post, PUBLIC_BASE_URL, sourceLang, ogPath ? ogImage : null)}</script>
<meta name="twitter:domain" content="${new URL(PUBLIC_BASE_URL).hostname}">
<!-- Retain the existing analytics site ID to preserve historical reporting across the domain migration. -->
<script defer data-domain="xmirror.app" src="https://a.zhxs.me/js/script.js"></script>
<link rel="preload" href="/xput-logo.svg" as="image" type="image/svg+xml">
<link rel="stylesheet" href="/theme.css?v=${APP_VERSION}">
<link rel="stylesheet" href="/article.css?v=${APP_VERSION}">
</head>
<body class="mirror-page">
<nav class="article-tools" aria-label="页面设置"><button class="quiet-button" type="button" onclick="toggleTheme()" aria-label="切换主题"><span aria-hidden="true">◐</span></button><button class="quiet-button article-lang" type="button" aria-hidden="true">EN</button></nav>
<div class="container">
<div class="post" data-post-id="${post.id}" data-source-lang="${sourceLang}">
<div class="article-byline">
<img class="avatar" width="38" height="38" alt="" decoding="async" src="${escapeHtml(post.author_avatar)}" onerror="this.style.display='none'">
<div class="author-info"><div class="author-name">${escapeHtml(post.author)}</div><div class="author-handle">@${escapeHtml(post.author_handle)}</div></div>
</div>
${prepared.headingHtml}
${publishedAt ? `<p class="post-published">原帖发布于 <time datetime="${publishedAt}">${publishedAt.slice(0,10)}</time></p>` : ''}
<div class="translate-toolbar">
<button id="translateBtn" class="translate-btn" type="button" onclick="toggleTranslate()" aria-controls="originContent translatedContent" aria-busy="false">翻译为中文</button>
<span id="translateStatus" class="translate-status" role="status" aria-live="polite" aria-atomic="true"></span>
</div>
<div id="originContent" class="content content-view active" aria-hidden="false">${content}</div>
<div id="translatedContent" class="content content-view" aria-hidden="true"></div>
${videoHtml}
<nav class="archive-navigation" aria-label="存档导航"><a href="/browse">浏览公开存档</a><a href="/report?post=${post.short_code}">投诉／删除申请</a></nav>
${post.related?.length ? `<section class="related-posts"><h2>同一作者的其他存档</h2><ul>${post.related.map(p => `<li><a href="/${p.short_code}">${seo.escape(seo.metadata(p).title)}</a></li>`).join('')}</ul></section>` : ''}
<div class="article-end"><a class="back-home" href="/">← 返回 XPut 首页</a><span class="saved-mark"><time class="article-time" datetime="${createdAt}">${new Date(createdAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time> 保存</span><a class="source" href="${refererPath}" target="_blank" rel="noopener noreferrer">在 X 查看原帖 ↗</a></div>
</div></div>
<script src="/seo-events.js?v=${APP_VERSION}" defer></script>
<script src="/mirror-page.js?v=${APP_VERSION}-links2" defer></script>
</body>
</html>`;

  return html;
}

function gifAttributes(isGif) {
  return isGif ? 'autoplay loop muted playsinline' : 'controls playsinline preload="metadata"';
}

function buildExtraVideosHtml(post) {
  let extras;
  try { extras = JSON.parse(post.extra_videos || '[]'); } catch { return ''; }
  return extras.map(extra => {
    if (extra.status === 'completed' && /^\/videos\/[A-Za-z0-9_.-]+$/.test(extra.path || '')) {
      return `<div class="video-shell"><video ${gifAttributes(extra.type === 'gif')} aria-label="${escapeHtml(seo.metadata(post).title)}"><source src="${escapeHtml(extra.path)}" type="video/mp4"></video></div>`;
    }
    if (extra.status === 'failed') return '<div class="video-placeholder video-placeholder-error" role="status">附加视频下载失败，请重新提交原链接重试。</div>';
    return '<div class="video-placeholder" role="status">附加视频下载中，请稍后刷新页面。</div>';
  }).join('');
}

function buildVideoPlayerHtml(post) {
  const isGif = Number(post.video_is_gif) === 1;
  const video = `<video ${gifAttributes(isGif)} aria-label="${escapeHtml(seo.metadata(post).title)}"><source src="${escapeHtml(post.video)}" type="video/mp4"></video>`;
  // GIFs have no audio track, so subtitles make no sense for them.
  if (isGif) return `<div class="video-shell" data-video-post-id="${post.id}">${video}</div>`;
  return `<div class="video-shell" data-video-post-id="${post.id}">
    ${video}
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

async function getPostById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM posts WHERE id=?', [id], (err, row) => err ? reject(err) : resolve(row));
  });
}

app.get('/api/posts/:id/video-status', async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ success: false, error: '无效 postId' });
  }
  try {
    const post = await getPostById(postId);
    if (!post) return res.status(404).json({ success: false, error: '存档不存在' });
    const status = post.video_status || (post.video ? 'completed' : 'none');
    const bytes = Number(post.video_bytes) || 0;
    const total = Number(post.video_total_bytes) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((bytes / total) * 10000) / 100) : 0;
    return res.json({
      success: true,
      status,
      bytes,
      total,
      percent,
      video: status === 'completed' ? post.video : null,
      error: status === 'failed' ? (post.video_error || '视频下载失败') : null
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || '读取视频状态失败' });
  }
});

app.get('/api/posts/:id/subtitles', async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ success: false, error: '无效 postId' });
  }
  try {
    const post = await getPostById(postId);
    if (!post) return res.status(404).json({ success: false, error: '存档不存在' });
    const rows = await getSubtitleTracks(postId);
    const tracks = {};
    for (const [lang, label] of Object.entries(SUBTITLE_LANGUAGES)) {
      const row = rows.find(item => item.lang === lang);
      tracks[lang] = {
        lang,
        label,
        status: row?.status || 'none',
        progress: Number(row?.progress) || 0,
        coveredUntil: Number(row?.covered_until) || 0,
        src: ['partial', 'completed'].includes(row?.status) ? row.vtt_path : null,
        error: row?.status === 'failed' ? (row.error || '字幕生成失败') : null
      };
    }
    return res.json({ success: true, tracks });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || '读取字幕状态失败' });
  }
});

app.post('/api/posts/:id/subtitles', async (req, res) => {
  const postId = Number(req.params.id);
  const lang = normalizeSubtitleLanguage(req.body?.lang || req.query.lang);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ success: false, error: '无效 postId' });
  }
  if (!lang) return res.status(400).json({ success: false, error: '不支持的字幕语言' });
  try {
    const post = await getPostById(postId);
    if (!post) return res.status(404).json({ success: false, error: '存档不存在' });
    if (post.video_status !== 'completed' || !post.video) {
      return res.status(409).json({ success: false, error: '视频尚未下载完成' });
    }
    const current = await getSubtitleTrack(postId, lang);
    if (current?.status === 'completed') {
      return res.json({ success: true, status: 'completed', progress: 100, src: current.vtt_path, cached: true });
    }
    await queueSubtitleJob(postId, lang);
    return res.status(202).json({ success: true, status: 'queued', progress: 0, cached: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || '字幕任务创建失败' });
  }
});

function healDbWriteability() {
  try { fs.chmodSync(DATA_DIR, 0o750); } catch {}
  try { fs.chmodSync(dbPath, 0o640); } catch {}
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
  await refreshSeo(postId);
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function translationJobPayload(job, segments = []) {
  const counts = translationProgress(job.total_segments, job.completed_segments, job.failed_segments);
  return {
    id: job.id,
    postId: job.post_id,
    targetLang: job.target_lang,
    sourceHash: job.source_hash,
    status: job.status,
    sourceLang: job.source_lang || 'auto',
    error: job.last_error || null,
    ...counts,
    blocks: segments.map(segment => ({
      index: segment.segment_index,
      type: segment.block_type,
      sourceText: segment.source_text,
      text: segment.status === 'completed' ? segment.translated_text : segment.source_text,
      translated: segment.status === 'completed',
      status: segment.status === 'failed' ? 'failed' : segment.status
    }))
  };
}

async function readTranslationJob(jobId) {
  const job = await dbGet('SELECT * FROM translation_jobs WHERE id=?', [jobId]);
  if (!job) return null;
  const segments = await dbAll('SELECT * FROM translation_segments WHERE job_id=? ORDER BY segment_index', [jobId]);
  return translationJobPayload(job, segments);
}

async function persistTranslationJobCounts(jobId) {
  const counts = await dbGet(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS pending
    FROM translation_segments WHERE job_id=?`, [jobId]);
  await runDbWrite(
    `UPDATE translation_jobs SET total_segments=?, completed_segments=?, failed_segments=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [Number(counts?.total) || 0, Number(counts?.completed) || 0, Number(counts?.failed) || 0, jobId]
  );
  return counts;
}

function enqueueTranslationJob(jobId) {
  const key = String(jobId);
  if (translationQueued.has(key) || translationRunning.has(key)) return;
  translationQueued.add(key);
  translationQueue.push(Number(jobId));
  pumpTranslationQueue();
}

function isUsableCachedTranslation(value) {
  const text = String(value || '').trim();
  if (!text || /^[\[{]/.test(text) || /[\]}]$/.test(text)) return false;
  return !/(?:^|[\s"'])(?:task|targetLang|parts|translations|翻译数组|目标语言|部分)(?:\s*["']?\s*:)/i.test(text);
}

async function processTranslationJob(jobId) {
  const leaseToken = crypto.randomUUID();
  const job = await dbGet('SELECT * FROM translation_jobs WHERE id=?', [jobId]);
  if (!job || ['completed', 'failed'].includes(job.status)) return;
  await runDbWrite(
    `UPDATE translation_jobs SET status='running', lease_token=?, lease_until=datetime('now','+5 minutes'), started_at=COALESCE(started_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [leaseToken, jobId]
  );

  while (true) {
    const current = await dbGet('SELECT * FROM translation_jobs WHERE id=?', [jobId]);
    if (!current) return;
    const pending = await dbAll(
      `SELECT * FROM translation_segments WHERE job_id=? AND status IN ('queued','retry') ORDER BY segment_index`,
      [jobId]
    );
    if (!pending.length) {
      const counts = await persistTranslationJobCounts(jobId);
      const status = Number(counts.failed) > 0 ? (Number(counts.completed) ? 'partial_failed' : 'failed') : 'completed';
      await runDbWrite(`UPDATE translation_jobs SET status=?, lease_token=NULL, lease_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`, [status, jobId, leaseToken]);
      if (status === 'completed') {
        const segments = await dbAll('SELECT * FROM translation_segments WHERE job_id=? ORDER BY segment_index', [jobId]);
        await upsertTranslation({
          postId: current.post_id,
          targetLang: current.target_lang,
          sourceLang: current.source_lang || 'auto',
          sourceHashValue: current.source_hash,
          translations: segments.map(segment => segment.translated_text || '')
        });
      }
      return;
    }

    const first = Number(current.completed_segments) === 0;
    const batch = nextTranslationBatch(pending, { first });
    const indexes = batch.map(segment => segment.segment_index);
    await runDbWrite(
      `UPDATE translation_segments SET status='running', updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND segment_index IN (${indexes.map(() => '?').join(',')})`,
      [jobId, ...indexes]
    );
    try {
      const result = await translateWithSiliconFlow(batch.map(segment => segment.source_text), current.target_lang, Math.max(...batch.map(segment => Number(segment.attempts) || 0)));
      for (let index = 0; index < batch.length; index += 1) {
        const translated = String(result.translations[index] || '').trim();
        if (!translated) throw new TranslationFormatError();
        await runDbWrite(
          `UPDATE translation_segments SET translated_text=?, status='completed', attempts=attempts+1, error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND segment_index=?`,
          [translated, jobId, batch[index].segment_index]
        );
      }
      if (result.sourceLang && result.sourceLang !== 'auto') {
        await runDbWrite(`UPDATE translation_jobs SET source_lang=?, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [result.sourceLang, jobId]);
      }
    } catch (error) {
      const response = translationErrorResponse(error);
      for (const segment of batch) {
        const attempts = Number(segment.attempts || 0) + 1;
        const exhausted = attempts >= TRANSLATION_BATCH_RETRIES || [401, 402, 403].includes(error?.providerStatus) || (!SILICONFLOW_API_KEY);
        await runDbWrite(
          `UPDATE translation_segments SET status=?, attempts=?, error_code=?, error_message=?, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND segment_index=?`,
          [exhausted ? 'failed' : 'retry', attempts, error?.code || error?.providerCode || 'TRANSLATION_ERROR', response.message, jobId, segment.segment_index]
        );
      }
      await runDbWrite(`UPDATE translation_jobs SET last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [response.message, jobId]);
    }
    await persistTranslationJobCounts(jobId);
  }
}

function pumpTranslationQueue() {
  while (activeTranslationJobs < TRANSLATION_CONCURRENCY && translationQueue.length) {
    const jobId = translationQueue.shift();
    translationQueued.delete(String(jobId));
    if (translationRunning.has(String(jobId))) continue;
    translationRunning.add(String(jobId));
    activeTranslationJobs += 1;
    processTranslationJob(jobId)
      .catch(error => console.error(`翻译任务失败 (${jobId}):`, error.message))
      .finally(() => {
        activeTranslationJobs -= 1;
        translationRunning.delete(String(jobId));
        pumpTranslationQueue();
      });
  }
}

function queuePendingTranslationJobs() {
  dbAll(`SELECT id FROM translation_jobs WHERE status IN ('queued','running','partial_failed')
    AND (lease_until IS NULL OR lease_until < datetime('now'))`)
    .then(rows => rows.forEach(row => enqueueTranslationJob(row.id)))
    .catch(error => console.error('恢复翻译任务失败:', error.message));
}

async function createOrGetTranslationJob(postId, targetLang) {
  const post = await getPostById(postId);
  if (!post) {
    const error = new Error('存档不存在');
    error.code = 'ARCHIVE_NOT_FOUND';
    throw error;
  }
  const blocks = extractTranslatableBlocks(post.content || '');
  const chars = totalCharacters(blocks);
  if (!blocks.length) {
    const error = new Error('无可翻译内容');
    error.code = 'NO_TRANSLATABLE_CONTENT';
    throw error;
  }
  if (blocks.length > MAX_TRANSLATABLE_SEGMENTS || chars > MAX_TRANSLATABLE_CHARS) {
    const error = new Error('文章超过翻译上限');
    error.code = 'TRANSLATION_LIMIT';
    throw error;
  }
  const sourceHashValue = translationSourceHash(blocks.map(block => block.text));
  const key = buildTranslationJobKey({ postId, targetLang, sourceHash: sourceHashValue });
  const existing = await dbGet('SELECT * FROM translation_jobs WHERE job_key=?', [key]);
  if (existing) {
    if (['queued', 'running', 'partial_failed'].includes(existing.status)) enqueueTranslationJob(existing.id);
    return readTranslationJob(existing.id);
  }

  const cached = await dbGet('SELECT * FROM translations WHERE post_id=? AND target_lang=? AND source_hash=?', [postId, targetLang, sourceHashValue]);
  let cachedParts = [];
  try { cachedParts = JSON.parse(cached?.translated_json || '{}').parts || []; } catch {}
  const isCachedComplete = cachedParts.length === blocks.length && cachedParts.every(isUsableCachedTranslation);
  let inserted;
  try {
    inserted = await runDbWrite(
      `INSERT INTO translation_jobs(job_key,post_id,target_lang,source_hash,strategy_version,status,total_segments,completed_segments,source_lang,last_error)
       VALUES(?,?,?,?,?,?,?,?,?,NULL)`,
      [key, postId, targetLang, sourceHashValue, TRANSLATION_STRATEGY_VERSION, isCachedComplete ? 'completed' : 'queued', blocks.length, isCachedComplete ? blocks.length : 0, cached?.source_lang || 'auto']
    );
  } catch (error) {
    // Two tabs may create the same identity at once. The unique key makes one
    // writer win; the other request simply returns that durable task.
    if (!String(error.message || '').includes('UNIQUE')) throw error;
    const winner = await dbGet('SELECT id, status FROM translation_jobs WHERE job_key=?', [key]);
    if (!winner) throw error;
    if (['queued', 'running', 'partial_failed'].includes(winner.status)) enqueueTranslationJob(winner.id);
    return readTranslationJob(winner.id);
  }
  for (let index = 0; index < blocks.length; index += 1) {
    await runDbWrite(
      `INSERT INTO translation_segments(job_id,segment_index,block_type,source_text,translated_text,status) VALUES(?,?,?,?,?,?)`,
      [inserted.lastID, index, blocks[index].type, blocks[index].text, isCachedComplete ? cachedParts[index] : null, isCachedComplete ? 'completed' : 'queued']
    );
  }
  if (!isCachedComplete) enqueueTranslationJob(inserted.lastID);
  return readTranslationJob(inserted.lastID);
}

const translationTaskRateLimit = createRateLimiter({
  windowMs: Number(process.env.TRANSLATE_RATE_WINDOW_MS) || 60000,
  max: Number(process.env.TRANSLATE_RATE_MAX) || 10
});

app.post('/api/translate/:id/tasks', translationTaskRateLimit, async (req, res) => {
  const postId = Number(req.params.id);
  const targetLang = normalizeTargetLanguage(req.body?.targetLang || req.query.targetLang || 'zh-CN');
  if (!Number.isInteger(postId) || postId <= 0) return res.status(400).json({ success: false, code: 'INVALID_POST_ID', error: '无效 postId' });
  if (!targetLang) return res.status(400).json({ success: false, code: 'UNSUPPORTED_LANGUAGE', error: '不支持的目标语言' });
  try {
    const task = await createOrGetTranslationJob(postId, targetLang);
    return res.status(task.status === 'completed' ? 200 : 202).json({ success: true, task });
  } catch (error) {
    if (error.code === 'ARCHIVE_NOT_FOUND') return res.status(404).json({ success: false, code: 'ARCHIVE_NOT_FOUND', error: error.message });
    if (error.code === 'NO_TRANSLATABLE_CONTENT') return res.status(400).json({ success: false, code: error.code, error: error.message });
    if (error.code === 'TRANSLATION_LIMIT') return res.status(413).json({ success: false, code: error.code, error: error.message });
    console.error('Translation task creation failed:', error.message);
    return res.status(503).json({ success: false, code: 'TRANSLATION_SERVICE_UNAVAILABLE', error: '翻译服务暂时不可用，请稍后重试' });
  }
});

app.get('/api/translate/tasks/:taskId', async (req, res) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ success: false, code: 'INVALID_TASK_ID', error: '无效任务 ID' });
  try {
    const task = await readTranslationJob(taskId);
    if (!task) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', error: '翻译任务不存在' });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(503).json({ success: false, code: 'TRANSLATION_STATUS_UNAVAILABLE', error: '翻译进度暂时无法读取' });
  }
});

app.post('/api/translate/tasks/:taskId/retry', translationTaskRateLimit, async (req, res) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ success: false, code: 'INVALID_TASK_ID', error: '无效任务 ID' });
  try {
    const task = await dbGet('SELECT * FROM translation_jobs WHERE id=?', [taskId]);
    if (!task) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', error: '翻译任务不存在' });
    await runDbWrite(`UPDATE translation_segments SET status='queued', attempts=0, error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status='failed'`, [taskId]);
    await runDbWrite(`UPDATE translation_jobs SET status='queued', last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [taskId]);
    enqueueTranslationJob(taskId);
    return res.status(202).json({ success: true, task: await readTranslationJob(taskId) });
  } catch (error) {
    return res.status(503).json({ success: false, code: 'TRANSLATION_RETRY_UNAVAILABLE', error: '重试任务暂时无法提交' });
  }
});

const translateRateLimit = createRateLimiter({
  windowMs: Number(process.env.TRANSLATE_RATE_WINDOW_MS) || 60000,
  max: Number(process.env.TRANSLATE_RATE_MAX) || 10
});

app.get('/api/translate/:id', translateRateLimit, async (req, res) => {
  const postId = Number(req.params.id);
  const targetLang = normalizeTargetLanguage(req.query.targetLang || 'zh-CN');
  if (!postId) return res.status(400).json({ success: false, error: '无效 postId' });
  if (!targetLang) return res.status(400).json({ success: false, error: '不支持的目标语言' });

  try {
    const post = await getPostById(postId);
    if (!post) return res.status(404).json({ success: false, error: '存档不存在' });

    const blocks = extractTranslatableBlocks(post.content || '');
    const parts = blocks.map(block => block.text);
    if (!parts.length) return res.status(400).json({ success: false, error: '无可翻译内容' });

    const hash = translationSourceHash(parts);
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
      if (translated.length === parts.length && translated.every(isUsableCachedTranslation)) {
        return res.json({ success: true, cached: true, sourceLang: cached.source_lang || 'auto', targetLang, parts: translated,
          blocks: blocks.map((block, index) => ({ type: block.type, text: translated[index] })) });
      }
    }

    const result = await translateInBatches(parts, batch => translateWithSiliconFlow(batch, targetLang));
    await upsertTranslation({
      postId,
      targetLang,
      sourceLang: result.sourceLang,
      sourceHashValue: hash,
      translations: result.translations
    });

    res.json({ success: true, cached: false, sourceLang: result.sourceLang, targetLang, parts: result.translations,
      blocks: blocks.map((block, index) => ({ type: block.type, text: result.translations[index] })) });
  } catch (e) {
    console.error('Translation failed:', e);
    const response = translationErrorResponse(e);
    res.status(response.status).json({ success: false, error: response.message });
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

function readRecentModerationLogs(limit = 50, action = '') {
  try {
    if (!fs.existsSync(MODERATION_LOG_PATH)) return [];
    const lines = fs.readFileSync(MODERATION_LOG_PATH, 'utf8').split('\n').filter(Boolean);
    let logs = lines.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    return groupLogs(logs, { action, limit });
  } catch (err) {
    console.warn('读取 moderation logs 失败:', err.message);
    return [];
  }
}

function cleanupFetchedAssets(content = {}) {
  const imagePaths = Array.isArray(content.images) ? content.images : [];
  for (const imagePath of imagePaths) {
    deleteMediaAssetBestEffort(DATA_DIR, imagePath);
  }

  deleteMediaAssetBestEffort(DATA_DIR, content.video);
}

async function archiveXUrl(url) {
  const canonicalUrl = normalizeArchiveUrl(url);
  const tweetId = extractTweetId(canonicalUrl);
  const moderationSettings = getModerationSettings();
  if (moderationSettings.enabled) {
    moderator.precheckUrl(canonicalUrl);
  }

  const existing = await new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM posts WHERE url=? OR url LIKE ? OR url LIKE ? ORDER BY id ASC',
      [canonicalUrl, `%/status/${tweetId}%`, `%/article/${tweetId}%`],
      (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).find(row => extractTweetId(row.url) === tweetId));
      }
    );
  });
  if (existing) {
    // Repair archives created by the old X Article precedence bug while keeping
    // their original id, file name, and short code.
    if (isBrokenArticleArchive(existing.content)) {
      const refreshed = await fetchXPost(canonicalUrl);
      if (moderationSettings.enabled) {
        await reviewService.assess({
          url: canonicalUrl,
          authorHandle: refreshed.author_handle,
          authorName: refreshed.author,
          content: refreshed.content
        });
      }
      await runDbWrite(
        `UPDATE posts SET author=?,author_handle=?,author_avatar=?,content=?,images=?,video=?,
         video_status=?,video_source_url=?,video_filename=?,video_bytes=?,video_total_bytes=?,video_error=?,tweet_time=?,
         video_is_gif=?,extra_videos=? WHERE id=?`,
        [refreshed.author, refreshed.author_handle, refreshed.author_avatar, refreshed.content,
          JSON.stringify(refreshed.images), refreshed.video, refreshed.video_status, refreshed.video_source_url,
          refreshed.video_filename, refreshed.video_bytes, refreshed.video_total_bytes, refreshed.video_error,
          refreshed.tweet_time, refreshed.video_is_gif, refreshed.extra_videos, existing.id]
      );
      Object.assign(existing, refreshed, { images: JSON.stringify(refreshed.images) });
    }
    if (!existing.short_code) {
      existing.short_code = await generateUniqueShortCode();
      await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [existing.short_code, existing.id]);
    }
    await seoStore.invalidate(existing.id);
    await refreshSeo(existing.id);
    Object.assign(existing, await getPostById(existing.id));
    const htmlPath = path.join(ARCHIVES_DIR, existing.html_file);
    const htmlContent = generateMirrorHtml(existing);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    await resumeVideoDownloadIfNeeded(existing);
    return archiveSuccessResponse(existing, true);
  }

  const content = await fetchXPost(canonicalUrl);
  if (!content.content && content.images.length === 0 && !content.video && !content.video_source_url) {
    throw new ArchiveError('CONTENT_UNSUPPORTED');
  }

  if (moderationSettings.enabled) {
    try {
      await reviewService.assess({
        url: canonicalUrl,
        authorHandle: content.author_handle,
        authorName: content.author,
        content: content.content
      });
    } catch (err) {
      if (err instanceof ModerationRejectError || err.code === 'CONTENT_MODERATION_PENDING') {
        cleanupFetchedAssets(content);
      }
      throw err;
    }
  }

  const timestamp = Date.now();
  const htmlFile = `post_${timestamp}.html`;
  const shortCode = await generateUniqueShortCode();

  let stmt;
  try {
    stmt = await runDbWrite(
      `INSERT INTO posts(url,author,author_handle,author_avatar,content,images,video,video_status,video_source_url,
       video_filename,video_bytes,video_total_bytes,video_error,tweet_time,html_file,short_code,video_is_gif,extra_videos)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [canonicalUrl, content.author, content.author_handle, content.author_avatar, content.content, JSON.stringify(content.images),
        content.video, content.video_status, content.video_source_url, content.video_filename, content.video_bytes,
        content.video_total_bytes, content.video_error, content.tweet_time, htmlFile, shortCode,
        content.video_is_gif, content.extra_videos]
    );
  } catch (insertErr) {
    if (String(insertErr.message || '').includes('UNIQUE constraint failed: posts.url')) {
      const existing2 = await new Promise((r, j) => db.get('SELECT * FROM posts WHERE url=?', [canonicalUrl], (e, row) => e ? j(e) : r(row)));
      if (existing2) {
        if (!existing2.short_code) {
          existing2.short_code = await generateUniqueShortCode();
          await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [existing2.short_code, existing2.id]);
        }
        const htmlPath = path.join(ARCHIVES_DIR, existing2.html_file);
        await refreshSeo(existing2.id);
        Object.assign(existing2, await getPostById(existing2.id));
        const htmlContent = generateMirrorHtml(existing2);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        await resumeVideoDownloadIfNeeded(existing2);
        return archiveSuccessResponse(existing2, true);
      }
    }
    throw insertErr;
  }

  const result = stmt.lastID;
  await seoStore.run('UPDATE posts SET seo_quality_version=?,seo_ai_enabled=1 WHERE id=?', [process.env.SEO_QUALITY_VERSION === '2' ? '2' : '3', result]);
  await refreshSeo(result);
  const htmlContent = generateMirrorHtml(await getPostById(result));
  fs.writeFileSync(path.join(ARCHIVES_DIR, htmlFile), htmlContent, 'utf8');
  if (content.video_source_url) {
    queueVideoDownload({ postId: result, url: content.video_source_url, filename: content.video_filename });
  }

  return archiveSuccessResponse({ id: result, ...content, short_code: shortCode });
}

function sendArchiveError(res, error) {
  console.error('Archive request failed:', error);
  const response = archiveErrorResponse(error);
  return res.status(response.status).json(response.body);
}

// One budget per visitor shared by every endpoint that triggers an upstream fetch.
const FETCH_RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.FETCH_RATE_LIMIT_PER_MIN) || 20);
const fetchRateLimit = createRateLimiter({
  windowMs: 60000,
  max: FETCH_RATE_LIMIT_PER_MIN,
  code: 'RATE_LIMITED',
  message: '请求过于频繁，请稍后再试'
});

app.post('/api/archive', fetchRateLimit, async (req, res) => {
  try {
    const payload = await archiveXUrl(req.body?.url);
    return res.json(payload);
  } catch (error) {
    return sendArchiveError(res, error);
  }
});

app.post('/api/resolve', fetchRateLimit, async (req, res) => {
  try {
    const payload = await resolveUrl(req.body?.url, { confirmAge: req.body?.confirm_age === true }, {
      fetchTweet,
      precheck: url => { if (getModerationSettings().enabled) moderator.precheckUrl(url); },
      assess: payload => getModerationSettings().enabled ? reviewService.assess(payload) : null,
      escapeHtml
    });
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (error) {
    return sendArchiveError(res, error);
  }
});

app.get('/api/archive/quick', fetchRateLimit, async (req, res) => {
  const rawUrl = (req.query.url || '').toString().trim();
  const format = (req.query.format || 'redirect').toString().toLowerCase();

  try {
    const payload = await archiveXUrl(rawUrl);
    const absoluteUrl = buildPublicUrl(payload.url, PUBLIC_BASE_URL);

    if (format === 'json') {
      return res.json({ ...payload, absolute_url: absoluteUrl });
    }

    if (format === 'text') {
      return res.type('text/plain; charset=utf-8').send(absoluteUrl);
    }

    return res.redirect(302, absoluteUrl);
  } catch (e) {
    return sendArchiveError(res, e);
  }
});

app.get('/api/posts', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  db.all(
    'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit + 1, offset],
    (e, r) => {
      if (e) {
        console.error('Read public archives failed:', e);
        return res.status(503).json({ error: '服务暂时不可用', code: 'SERVICE_UNAVAILABLE' });
      }

      const hasMore = (r || []).length > limit;
      const pageRows = (r || []).slice(0, limit).map(post => ({
        ...post,
        title: seo.metadata(post).title,
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

app.use('/api/admin/moderation', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

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
  const action = (req.query.action || '').toString().trim();
  return res.json({ success: true, logs: readRecentModerationLogs(limit, action) });
});


// Admin rechecks retrieve text only; they do not create archives or download media.
const reviewAdminLimit = createRateLimiter({ windowMs: 60000, max: 10 });
app.post('/api/admin/moderation/recheck', requireAdmin, reviewAdminLimit, async (req, res) => {
  try {
    const url = normalizeArchiveUrl(req.body?.url);
    const tweetId = extractTweetId(url);
    fetchTweet.cache.delete(tweetId); // rechecks must see the current text
    const tweet = await fetchTweet(tweetId);
    if (isSensitiveTweet(tweet)) return res.status(409).json({ error: '原平台敏感标记需人工检查媒体，本次未放行' });
    const rendered = renderTweetContent({ tweet, escapeHtml });
    try {
      await reviewService.assess({ url, authorHandle: tweet.author.screen_name, authorName: tweet.author.name, content: rendered.htmlContent }, { retry: true });
    } catch (e) {
      if (!['CONTENT_MODERATION_REJECTED', 'CONTENT_MODERATION_PENDING'].includes(e.code)) throw e;
    }
    return res.json({ success: true });
  } catch { return res.status(502).json({ error: '重新获取原文失败，请稍后再试' }); }
});
app.get('/api/admin/moderation/reviews/:id', requireAdmin, (req, res) => {
  const record = reviewService.read(req.params.id);
  if (!record) return res.status(404).json({ error: '没有可复核的正文，请先重新审核' });
  return res.json({ success: true, record });
});
app.post('/api/admin/moderation/reviews/:id', requireAdmin, async (req, res) => {
  try {
    const result = await seoStore.decideReview(req.params.id, req.body?.action, req.body?.note);
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

app.post('/api/delete', requireAdmin, async (req, res) => {
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
      deleteMediaAsset(DATA_DIR, imgPath);
    }

    deleteMediaAsset(DATA_DIR, post.video);
    try {
      for (const extra of JSON.parse(post.extra_videos || '[]')) {
        if (extra.path) deleteMediaAsset(DATA_DIR, extra.path);
        if (extra.filename) { try { fs.unlinkSync(`${videoPathForFilename(extra.filename)}.part`); } catch {} }
      }
    } catch {}
    if (post.video_filename) {
      try { fs.unlinkSync(`${videoPathForFilename(post.video_filename)}.part`); } catch {}
    }

    const subtitleRows = await getSubtitleTracks(id);
    for (const subtitle of subtitleRows) {
      if (subtitle.vtt_path) {
        try { fs.unlinkSync(path.join(DATA_DIR, subtitle.vtt_path.replace(/^\/subtitles\//, 'subtitles/'))); } catch {}
      }
    }

    await runDbWrite('DELETE FROM translations WHERE post_id=?',[id]);
    await runDbWrite('DELETE FROM subtitle_tracks WHERE post_id=?',[id]);
    await runDbWrite('DELETE FROM post_aliases WHERE target_post_id=?',[id]);
    await runDbWrite('DELETE FROM posts WHERE id=?',[id]);

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
      db.get('SELECT * FROM posts WHERE html_file=?', [fileName], (err, row) => err ? reject(err) : resolve(row));
    });

    if (post?.short_code) {
      return res.redirect(301, `/${post.short_code}`);
    }
    if (post) {
      return res.set('Cache-Control', 'no-store').status(200).send(generateMirrorHtml(post));
    }
  } catch (e) {
    console.error('旧链接301映射失败:', e.message);
    return res.sendStatus(503);
  }

  return next();
});

app.use('/archives', (_req, res) => res.sendStatus(404));

app.get(/^\/([A-Za-z0-9]{6})\/referer$/, async (req, res, next) => {
  try {
    const shortCode = req.params[0];
    const post = await new Promise((resolve, reject) => {
      db.get(
        `SELECT url FROM posts WHERE short_code=?
         UNION ALL
         SELECT p.url FROM post_aliases a JOIN posts p ON p.id=a.target_post_id
         WHERE a.alias_code=? LIMIT 1`,
        [shortCode, shortCode],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!post?.url) return next();

    return res.set('X-Robots-Tag', 'noindex, follow').redirect(302, post.url);
  } catch (e) {
    console.error('中转链接跳转失败:', e.message);
    return next();
  }
});

app.get(/^\/([A-Za-z0-9]{6})$/, async (req, res, next) => {
  try {
    const shortCode = req.params[0];
    const post = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM posts WHERE short_code=?
         UNION ALL
         SELECT p.* FROM post_aliases a JOIN posts p ON p.id=a.target_post_id
         WHERE a.alias_code=? LIMIT 1`,
        [shortCode, shortCode],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!post) return next();

    if (post.short_code !== shortCode) return res.redirect(301, `/${post.short_code}`);
    res.set('Cache-Control', 'no-store');
    post.related = await seoStore.related(post);
    const htmlContent = generateMirrorHtml(post);
    return res.status(200).send(htmlContent);
  } catch (e) {
    console.error('短链访问失败:', e.message);
    return res.sendStatus(503);
  }
});

async function refreshSeo(id) {
  try { return await seoStore.refresh(id); }
  catch (error) {
    console.error('SEO evaluation failed:', id, error.message);
    return null;
  }
}

async function startServer() {
  try {
    await ensureShortCodeReady();
    await ensureVideoColumnsReady();
    await seoStore.migrate();
    await seoAI.migrate();
    await migrateReports(seoStore);
    let hashBatch;
    let hashCursor = 0;
    do { hashBatch = await seoStore.backfillHashes(100, hashCursor); hashCursor = hashBatch.lastId; } while (hashBatch.scanned === 100);
    console.log('短链字段与历史数据检查完成');
  } catch (e) {
    console.error('短链初始化失败:', e.message);
    process.exit(1);
  }

  app.listen(PORT,'0.0.0.0',()=>{
    console.log(`XMirror运行在http://0.0.0.0:${PORT}`);
    console.log(`SQLite: ${dbPath}`);
    const maintainSeo = () => seoStore.sweep(20).catch(e => console.error('SEO maintenance:', e.message));
    maintainSeo();
    setInterval(maintainSeo, 60000).unref();
    setInterval(() => seoAI.tick().catch(() => console.error('SEO title worker failed')), 5000).unref();
    queuePendingVideoDownloads();
    queuePendingSubtitleJobs();
    queuePendingTranslationJobs();
  });
}

startServer();
