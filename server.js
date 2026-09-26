const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { version: APP_VERSION } = require('./package.json');
const {
  transcribeVideo,
  segmentsToVtt
} = require('./lib/subtitles');
const { createModerator, ModerationRejectError } = require('./lib/moderation');
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
const { ArchiveError, normalizeArchiveUrl, archiveErrorResponse, readSourceResponse, archiveSuccessResponse } = require('./lib/archive-response');
const { registerHealthRoute } = require('./lib/health');
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
const SUBTITLE_SEGMENT_SECONDS = Math.max(30, Number(process.env.SUBTITLE_SEGMENT_SECONDS) || 60);
const SUBTITLE_CONCURRENCY = Math.max(1, Number(process.env.SUBTITLE_CONCURRENCY) || 2);
const MODERATION_ADMIN_TOKEN = process.env.MODERATION_ADMIN_TOKEN || '';
const requireAdmin = createAdminGuard(MODERATION_ADMIN_TOKEN);
const TRANSLATION_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.TRANSLATION_CONCURRENCY) || 2));
const TRANSLATION_BATCH_RETRIES = 3;
const translationQueue = [];
const translationQueued = new Set();
const translationRunning = new Set();
let activeTranslationJobs = 0;

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
const MODERATION_SETTINGS_PATH = path.join(DATA_DIR, 'moderation-settings.json');
const MODERATION_LOG_PATH = path.join(DATA_DIR, 'moderation.log.jsonl');

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
    ['video_error', 'TEXT']
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
    source_segments TEXT,
    vtt_path TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, lang)
  )`);

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

function extractTweetId(url) {
  return extractXPostId(url);
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
      res.on('error', reject);
      res.on('aborted', () => reject(new ArchiveError('NETWORK_ERROR')));
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(data);
          const json = JSON.parse(buffer.toString('utf8'));
          resolve(readSourceResponse(res.statusCode, json));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new ArchiveError('REQUEST_TIMEOUT')));
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

const VIDEO_DOWNLOAD_CONCURRENCY = Math.max(1, Number(process.env.VIDEO_DOWNLOAD_CONCURRENCY) || 1);
const videoQueue = [];
const videoJobs = new Set();
let activeVideoDownloads = 0;

function videoPathForFilename(filename) {
  return path.join(DATA_DIR, 'videos', filename);
}

function updateVideoRow(postId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return Promise.resolve();
  const values = keys.map(key => fields[key]);
  return runDbWrite(
    `UPDATE posts SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`,
    [...values, postId]
  );
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

async function processVideoJob(job) {
  const { postId, url, filename } = job;
  let lastReportedAt = 0;
  try {
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
  } catch (err) {
    console.error(`视频下载失败: ${err.message}`);
    await updateVideoRow(postId, { video_status: 'failed', video_error: err.message || '视频下载失败' });
  }
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

function queueVideoDownload({ postId, url, filename }) {
  if (!postId || !url || !filename || videoJobs.has(postId)) return false;
  videoJobs.add(postId);
  videoQueue.push({ postId, url, filename });
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
}

async function resumeVideoDownloadIfNeeded(post) {
  if (!post?.video_source_url || !post.video_filename) return;
  if (post.video_status === 'failed') {
    await updateVideoRow(post.id, { video_status: 'queued', video_bytes: 0, video_total_bytes: 0, video_error: null });
    post.video_status = 'queued';
  }
  if (['queued', 'downloading'].includes(post.video_status)) {
    queueVideoDownload({ postId: post.id, url: post.video_source_url, filename: post.video_filename });
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

async function translateWithSiliconFlow(parts, targetLang) {
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
    models,
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

async function ensureEnglishSubtitles(post, progressStart = 0, progressScale = 100) {
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
      onProgress: value => updateSubtitleTrack(post.id, 'en', {
        status: 'transcribing', progress: Math.round(progressStart + (value / 100) * progressScale), error: null
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
  const segments = await ensureEnglishSubtitles(post, lang === 'en' ? 0 : 0, lang === 'en' ? 100 : 60);
  if (lang === 'en') return;

  await updateSubtitleTrack(postId, lang, { status: 'translating', progress: 60, error: null });
  const result = await translateInBatches(
    segments.map(segment => segment.text),
    batch => translateWithSiliconFlow(batch, lang)
  );
  const translatedSegments = segments.map((segment, index) => ({ ...segment, text: result.translations[index] }));
  const vttPath = await writeSubtitleFile(postId, lang, segmentsToVtt(translatedSegments));
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

async function fetchXPost(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('无法提取推文ID');

  const tweet = await fetchFromFxTwitter(tweetId);

  // X 平台官方成人内容标记检测
  if (tweet.possibly_sensitive === true) {
    throw new ModerationRejectError("该推文被 X 平台标记为成人内容，无法存档", {
      stage: "x_platform_flag",
      url,
      tweetId,
      possibly_sensitive: true
    });
  }
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
  let videoSourceUrl = null;
  let videoFilename = null;
  let videoStatus = 'none';
  const videoUrl = media.videos?.[0]?.url;
  if (videoUrl) {
    const videoExt = videoUrl.split('.').pop().split('?')[0] || 'mp4';
    videoFilename = `${tweetId}_video.${videoExt.replace(/[^a-z0-9]/gi, '') || 'mp4'}`;
    videoSourceUrl = videoUrl;
    videoStatus = 'queued';
  }

  const { htmlContent } = renderTweetContent({ tweet, localImages, urlToLocalPath, escapeHtml });

  return {
    author: author.name || '未知用户',
    author_handle: author.screen_name || 'unknown',
    author_avatar: author.avatar_url || '',
    content: htmlContent,
    images: localImages,
    video: localVideoPath,
    video_source_url: videoSourceUrl,
    video_filename: videoFilename,
    video_status: videoStatus,
    video_bytes: 0,
    video_total_bytes: 0,
    video_error: null,
    tweet_time: normalizeXTimestamp(tweet.created_timestamp)
  };
}

function generateMirrorHtml(post) {
  const content = post.content || '';
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

  const summary = extractSummary(content);
  const ogImage = post.images && post.images.length > 0 ? post.images[0] : '';
  let articleTitle = '';
  const h1Match = content.match(/<h1[^>]*>(.+?)<\/h1>/i);
  const h2Match = content.match(/<h2[^>]*>(.+?)<\/h2>/i);
  if (h1Match) articleTitle = h1Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else if (h2Match) articleTitle = h2Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else articleTitle = summary.substring(0, 25);
  if (articleTitle.length >= 25) articleTitle += '...';
  const pageTitle = articleTitle ? `${escapeHtml(articleTitle)} | XPut` : `${escapeHtml(post.author)} | XPut`;
  const canonicalPath = post.short_code ? `/${post.short_code}` : `/archives/${post.html_file}`;
  const canonicalUrl = buildPublicUrl(canonicalPath, PUBLIC_BASE_URL);
  const refererPath = post.short_code ? `/${post.short_code}/referer` : post.url;
  const createdAt = normalizeXTimestamp(post.tweet_time, post.created_at || new Date().toISOString());
  const sourceLang = detectContentLanguage(content);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${escapeHtml(summary)}">
<meta name="keywords" content="X存档,Twitter存档,${escapeHtml(post.author)},推文备份,XPut">
<meta name="author" content="${escapeHtml(post.author)}">
<meta name="robots" content="index, follow">
<meta name="googlebot" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<link rel="icon" href="/favicon-32x32.png?v=2" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16x16.png?v=2" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
<link rel="mask-icon" href="/safari-pinned-tab.svg?v=2" color="#146b78">
<link rel="manifest" href="/site.webmanifest?v=2">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${escapeHtml(summary)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:site_name" content="XPut">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="${createdAt}">
<meta property="article:author" content="${escapeHtml(post.author)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${escapeHtml(summary)}">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:creator" content="@${escapeHtml(post.author_handle)}">
<meta name="twitter:domain" content="${new URL(PUBLIC_BASE_URL).hostname}">
<!-- Retain the existing analytics site ID to preserve historical reporting across the domain migration. -->
<script defer data-domain="xmirror.app" src="https://a.zhxs.me/js/script.js"></script>
<link rel="stylesheet" href="/theme.css?v=${APP_VERSION}">
<style>
.container{max-width:680px;margin:0 auto 18px}.post{background:color-mix(in srgb,var(--surface-color) 94%,transparent);border:1px solid var(--border-color);border-radius:22px;padding:clamp(16px,4vw,28px);box-shadow:var(--card-shadow);position:relative;overflow:hidden}.post::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--link-color),var(--accent-color));opacity:.85}
.header{display:flex;align-items:center;gap:12px;margin-bottom:8px}.avatar{width:42px;height:42px;border-radius:14px;margin-right:0;object-fit:cover;background:var(--border-color);box-shadow:0 3px 9px rgba(0,0,0,.12)}.author-info{flex:1}.author-name{font-weight:700;font-size:15px;color:var(--text-primary);display:flex;align-items:center;gap:4px}.author-handle{color:var(--text-secondary);font-size:13px}.theme-toggle{flex-shrink:0;width:36px;height:36px;border-radius:12px;border:1px solid var(--border-color);background:var(--hover-bg);color:var(--text-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:transform .18s,background .18s}.theme-toggle:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--accent-color) 16%,var(--hover-bg))}
.content{margin:8px 0;font-size:17px;line-height:1.72;word-wrap:break-word;color:var(--text-primary)}.content h1{font-size:22px;font-weight:800;margin:16px 0}.content h2{font-size:19px;font-weight:750;margin:15px 0}.content p{margin:13px 0}.content a{color:var(--link-color);text-decoration:none}.content a:hover{text-decoration:underline}.content img,.media-img{max-width:100%;border-radius:16px;margin:13px 0;border:1px solid var(--border-color);box-shadow:0 8px 20px rgba(35,63,74,.08)}video{max-width:100%;border-radius:16px;margin:13px 0}.video-placeholder{margin:13px 0;padding:20px 17px;border:1px solid var(--border-color);border-radius:16px;background:var(--hover-bg);color:var(--text-secondary)}.video-placeholder-title{color:var(--text-primary);font-weight:650;margin-bottom:14px}.video-progress{height:7px;background:var(--border-color);border-radius:999px;overflow:hidden}.video-progress-bar{height:100%;background:linear-gradient(90deg,var(--link-color),var(--accent-color));transition:width .4s ease}.video-progress-text{font-size:13px;margin-top:9px}.video-placeholder-error{color:var(--error-color)}
.subtitle-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px;color:var(--text-secondary);font-size:13px}.subtitle-select{border:1px solid var(--border-color);border-radius:10px;padding:6px 28px 6px 10px;background:var(--surface-color);color:var(--text-primary);font:inherit}.subtitle-status{font-size:12px}.subtitle-status.is-error{color:var(--error-color)}.translate-toolbar{display:flex;gap:8px;margin:8px 0 13px;align-items:center;flex-wrap:wrap}.translate-btn{padding:7px 13px;border:1px solid color-mix(in srgb,var(--link-color) 30%,var(--border-color));border-radius:11px;background:color-mix(in srgb,var(--link-color) 8%,var(--surface-color));color:var(--link-color);cursor:pointer;font-size:13px;font-weight:650;box-shadow:inset 0 1px 0 rgba(255,255,255,.35);transition:transform .16s,background .16s}.translate-btn:hover:not(:disabled){transform:translateY(-1px);background:color-mix(in srgb,var(--link-color) 14%,var(--surface-color))}.translate-btn[disabled]{opacity:.6;cursor:not-allowed}.translate-btn.is-loading::before{content:"";display:inline-block;width:12px;height:12px;margin-right:6px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:translate-spin .7s linear infinite}.translate-status{font-size:12px;color:var(--text-secondary);transition:opacity .2s}.translate-status.is-error{color:var(--error-color)}.translate-status.is-fading{opacity:0}.translate-retry{border:0;background:transparent;color:var(--link-color);font-size:12px;padding:5px 2px;cursor:pointer}.translate-retry:hover{text-decoration:underline}@keyframes translate-spin{to{transform:rotate(360deg)}}
.content-view{display:none}.content-view.active{display:block}.meta{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-color);color:var(--text-secondary);font-size:13px}.source{color:var(--link-color);text-decoration:none}.source:hover{text-decoration:underline}.time{display:flex;align-items:center;gap:8px}@media(max-width:600px){.mirror-page{padding:8px}.container{margin:0 0 10px}.post{border-radius:17px;padding:16px}.content{font-size:16px;line-height:1.68}}
</style>
</head>
<body class="mirror-page">
<div class="container">
<div class="post" data-post-id="${post.id}" data-source-lang="${sourceLang}">
<div class="header">
<img class="avatar" src="${post.author_avatar}" onerror="this.style.display='none'">
<div class="author-info"><div class="author-name">${escapeHtml(post.author)}</div><div class="author-handle">@${escapeHtml(post.author_handle)}</div></div>
<button class="theme-toggle" onclick="toggleTheme()" title="切换主题" aria-label="切换主题">🌓</button>
</div>
<div class="translate-toolbar">
<button id="translateBtn" class="translate-btn" type="button" onclick="toggleTranslate()" aria-controls="originContent translatedContent" aria-busy="false">翻译为中文</button>
<span id="translateStatus" class="translate-status" role="status" aria-live="polite" aria-atomic="true"></span>
</div>
<div id="originContent" class="content content-view active" aria-hidden="false">${content}</div>
<div id="translatedContent" class="content content-view" aria-hidden="true"></div>
${videoHtml}
<div class="meta"><div class="time"><span>${new Date(createdAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span>·</span><a class="source" href="${refererPath}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a></div></div>
</div></div>
<script src="/mirror-page.js?v=${APP_VERSION}" defer></script>
</body>
</html>`;

  return html;
}

function buildVideoPlayerHtml(post) {
  return `<div class="video-shell" data-video-post-id="${post.id}">
    <video controls style="max-width:100%;margin:10px 0;"><source src="${escapeHtml(post.video)}" type="video/mp4"></video>
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
        src: row?.status === 'completed' ? row.vtt_path : null,
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

async function translateBatchWithRetries(parts, targetLang) {
  let lastError;
  for (let attempt = 1; attempt <= TRANSLATION_BATCH_RETRIES; attempt += 1) {
    try {
      return await translateInBatches(parts, batch => translateWithSiliconFlow(batch, targetLang), { batchSize: parts.length });
    } catch (error) {
      lastError = error;
      const providerCode = error?.providerCode || error?.code;
      const permanent = providerCode === 'AUTH' || providerCode === 'INSUFFICIENT_BALANCE' || error?.status === 401;
      if (permanent || attempt === TRANSLATION_BATCH_RETRIES) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 2500)));
    }
  }
  throw lastError || new Error('翻译失败');
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
      const result = await translateBatchWithRetries(batch.map(segment => segment.source_text), current.target_lang);
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
        const exhausted = attempts >= TRANSLATION_BATCH_RETRIES;
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
  const isCachedComplete = cachedParts.length === blocks.length && cachedParts.every(value => typeof value === 'string' && value.trim());
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
      if (translated.length === parts.length) {
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

    if (action) {
      logs = logs.filter(log => log.action === action);
    }

    return logs.slice(-limit).reverse();
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
        moderator.moderateArchivedContent({
          url: canonicalUrl,
          authorHandle: refreshed.author_handle,
          authorName: refreshed.author,
          content: refreshed.content
        });
      }
      await runDbWrite(
        `UPDATE posts SET author=?,author_handle=?,author_avatar=?,content=?,images=?,video=?,
         video_status=?,video_source_url=?,video_filename=?,video_bytes=?,video_total_bytes=?,video_error=?,tweet_time=? WHERE id=?`,
        [refreshed.author, refreshed.author_handle, refreshed.author_avatar, refreshed.content,
          JSON.stringify(refreshed.images), refreshed.video, refreshed.video_status, refreshed.video_source_url,
          refreshed.video_filename, refreshed.video_bytes, refreshed.video_total_bytes, refreshed.video_error,
          refreshed.tweet_time, existing.id]
      );
      Object.assign(existing, refreshed, { images: JSON.stringify(refreshed.images) });
    }
    if (!existing.short_code) {
      existing.short_code = await generateUniqueShortCode();
      await runDbWrite('UPDATE posts SET short_code=? WHERE id=?', [existing.short_code, existing.id]);
    }
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
      moderator.moderateArchivedContent({
        url: canonicalUrl,
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

  const timestamp = Date.now();
  const htmlFile = `post_${timestamp}.html`;
  const shortCode = await generateUniqueShortCode();

  let stmt;
  try {
    stmt = await runDbWrite(
      `INSERT INTO posts(url,author,author_handle,author_avatar,content,images,video,video_status,video_source_url,
       video_filename,video_bytes,video_total_bytes,video_error,tweet_time,html_file,short_code)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [canonicalUrl, content.author, content.author_handle, content.author_avatar, content.content, JSON.stringify(content.images),
        content.video, content.video_status, content.video_source_url, content.video_filename, content.video_bytes,
        content.video_total_bytes, content.video_error, content.tweet_time, htmlFile, shortCode]
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
        const htmlContent = generateMirrorHtml(existing2);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        await resumeVideoDownloadIfNeeded(existing2);
        return archiveSuccessResponse(existing2, true);
      }
    }
    throw insertErr;
  }

  const result = stmt.lastID;
  const htmlContent = generateMirrorHtml({ id: result, url: canonicalUrl, ...content, html_file: htmlFile, short_code: shortCode });
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

app.post('/api/archive', async (req, res) => {
  try {
    const payload = await archiveXUrl(req.body?.url);
    return res.json(payload);
  } catch (error) {
    return sendArchiveError(res, error);
  }
});

app.get('/api/archive/quick', async (req, res) => {
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
  const action = (req.query.action || '').toString().trim();
  return res.json({ success: true, logs: readRecentModerationLogs(limit, action) });
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
    await ensureVideoColumnsReady();
    console.log('短链字段与历史数据检查完成');
  } catch (e) {
    console.error('短链初始化失败:', e.message);
    process.exit(1);
  }

  app.listen(PORT,'0.0.0.0',()=>{
    console.log(`XMirror运行在http://0.0.0.0:${PORT}`);
    console.log(`SQLite: ${dbPath}`);
    queuePendingVideoDownloads();
    queuePendingSubtitleJobs();
    queuePendingTranslationJobs();
  });
}

startServer();
