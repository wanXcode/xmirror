const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const DEFAULT_SEGMENT_SECONDS = 12;
const DEFAULT_TRANSCRIPTION_CONCURRENCY = 3;

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} 执行失败（${code}）${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`));
    });
  });
}

async function getMediaDuration(videoPath, ffprobe = 'ffprobe') {
  const { stdout } = await runProcess(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  return duration;
}

async function transcribeAudioFile(filePath, { apiKey, baseUrl, model = 'FunAudioLLM/SenseVoiceSmall' }) {
  if (!apiKey) throw new Error('未配置语音转写 API Key');
  const endpoint = new URL(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`);
  const boundary = `----xmirror-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const stat = await fs.promises.stat(filePath);
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\n` +
    'Content-Type: audio/mpeg\r\n\r\n'
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      callback(value);
    };
    const hardTimeout = setTimeout(() => {
      request.destroy(new Error('语音转写请求超时'));
    }, 120000);
    hardTimeout.unref?.();
    request = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': preamble.length + stat.size + ending.length
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(raw); } catch { json = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throwHttpError(response.statusCode, json, raw, error => settle(reject, error));
          return;
        }
        const text = json.text ?? json.data?.text ?? json.output?.text;
        if (typeof text !== 'string') {
          settle(reject, new Error('语音转写返回格式异常'));
          return;
        }
        settle(resolve, text.trim());
      });
    });
    request.on('error', error => settle(reject, error));
    request.setTimeout(120000, () => request.destroy(new Error('语音转写请求超时')));
    request.write(preamble);
    fs.createReadStream(filePath)
      .on('error', error => settle(reject, error))
      .on('end', () => request.end(ending))
      .pipe(request, { end: false });
  });
}

function throwHttpError(status, json, raw, reject) {
  const message = json?.message || json?.error?.message || raw.slice(0, 300) || `HTTP ${status}`;
  reject(new Error(`语音转写失败（${status}）: ${message}`));
}

async function transcribeVideo(videoPath, {
  apiKey,
  baseUrl = 'https://api.siliconflow.cn/v1',
  model = 'FunAudioLLM/SenseVoiceSmall',
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  segmentSeconds = DEFAULT_SEGMENT_SECONDS,
  concurrency = DEFAULT_TRANSCRIPTION_CONCURRENCY,
  tempRoot = os.tmpdir(),
  onProgress,
  onSegment
} = {}) {
  const duration = await getMediaDuration(videoPath, ffprobe);
  const tempDir = await fs.promises.mkdtemp(path.join(tempRoot, 'xmirror-subtitles-'));
  const pattern = path.join(tempDir, 'segment-%04d.mp3');
  try {
    await runProcess(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(segmentSeconds), '-reset_timestamps', '1', pattern
    ]);
    const files = (await fs.promises.readdir(tempDir))
      .filter(name => /^segment-\d+\.mp3$/.test(name))
      .sort()
      .map(name => path.join(tempDir, name));
    if (!files.length) throw new Error('视频没有可识别的音频片段');

    const segments = [];
    const limit = Math.max(1, Math.min(8, Number(concurrency) || DEFAULT_TRANSCRIPTION_CONCURRENCY));
    let completed = 0;
    for (let batchStart = 0; batchStart < files.length; batchStart += limit) {
      const batch = await Promise.all(files.slice(batchStart, batchStart + limit).map(async (file, offset) => {
        const index = batchStart + offset;
        const text = await transcribeAudioFile(file, { apiKey, baseUrl, model });
        const start = index * segmentSeconds;
        const end = Math.min(duration, (index + 1) * segmentSeconds);
        return text ? { index, start, end, text } : null;
      }));
      for (const segment of batch.filter(Boolean).sort((a, b) => a.index - b.index)) {
        const clean = { start: segment.start, end: segment.end, text: segment.text };
        segments.push({ index: segment.index, ...clean });
        await onSegment?.(clean, segment.index, files.length);
      }
      completed += batch.length;
      onProgress?.(Math.round((completed / files.length) * 100), completed, files.length);
    }
    segments.sort((a, b) => a.index - b.index);
    return segments.map(({ index, ...segment }) => segment);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function vttTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function escapeCueText(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');
}

function splitTimedSegment(segment) {
  const text = String(segment.text || '').trim();
  const parts = text.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(value => value.trim()).filter(Boolean) || [text];
  if (parts.length <= 1) return [{ ...segment, text }];
  const totalWeight = parts.reduce((sum, value) => sum + value.length, 0) || 1;
  const duration = Math.max(0, Number(segment.end) - Number(segment.start));
  let cursor = Number(segment.start) || 0;
  return parts.map((part, index) => {
    const end = index === parts.length - 1
      ? Number(segment.end)
      : cursor + duration * (part.length / totalWeight);
    const result = { start: cursor, end, text: part };
    cursor = end;
    return result;
  });
}

function segmentsToVtt(segments = []) {
  const cues = segments.flatMap(splitTimedSegment).map((segment, index) => `${index + 1}\n${vttTimestamp(segment.start)} --> ${vttTimestamp(segment.end)}\n${escapeCueText(segment.text)}\n`);
  return `WEBVTT\n\n${cues.join('\n')}`;
}

module.exports = {
  DEFAULT_SEGMENT_SECONDS,
  DEFAULT_TRANSCRIPTION_CONCURRENCY,
  runProcess,
  getMediaDuration,
  transcribeAudioFile,
  transcribeVideo,
  vttTimestamp,
  splitTimedSegment,
  segmentsToVtt
};
