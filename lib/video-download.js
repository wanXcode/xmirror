const fs = require('node:fs');
const https = require('node:https');

const VIDEO_CONNECT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

/**
 * Stream a video to `filePath` through `<filePath>.part`, renamed into place only after a complete
 * download. Every failure (bad status, upstream abort or error, truncated body, write error, timeout)
 * destroys the request, closes the write stream, deletes the `.part` file and only then rejects, so a
 * caller never sees an error while the temp file still exists. (A write stream opens its file
 * asynchronously, so unlinking before it has closed can miss the file and leave it behind.)
 * Resolves to { bytes, total }.
 */
function downloadVideoToFile(url, {
  filePath,
  onProgress,
  isAllowedUrl = () => true,
  request: doRequest = https.get,
  timeoutMs = VIDEO_CONNECT_TIMEOUT_MS,
  redirects = 0
}) {
  return new Promise((resolve, reject) => {
    if (!isAllowedUrl(url)) return reject(new Error('视频来源不在允许范围内'));
    const tempPath = `${filePath}.part`;
    let file;
    let request;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      request?.destroy();
      const finish = () => { try { fs.unlinkSync(tempPath); } catch { /* nothing to remove */ } reject(error); };
      if (!file || file.closed) return finish();
      file.once('close', finish);
      file.destroy();
    };
    request = doRequest(url, { headers: { 'User-Agent': 'XMirror/1.0' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (settled) return;
        settled = true;
        if (redirects >= MAX_REDIRECTS) return reject(new Error('视频下载重定向过多'));
        return downloadVideoToFile(response.headers.location, { filePath, onProgress, isAllowedUrl, request: doRequest, timeoutMs, redirects: redirects + 1 })
          .then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return fail(new Error(`下载失败，状态码: ${response.statusCode}`));
      }

      const total = Number(response.headers['content-length']) || 0;
      let downloaded = 0;
      file = fs.createWriteStream(tempPath);
      const report = () => onProgress?.(downloaded, total);
      response.on('data', chunk => {
        downloaded += chunk.length;
        report();
      });
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('视频下载被中断')));
      file.on('error', fail);
      file.on('finish', () => {
        if (settled) return;
        if (total && downloaded < total) return fail(new Error('视频下载不完整'));
        file.close(err => {
          if (settled) return;
          if (err) return fail(err);
          try {
            fs.renameSync(tempPath, filePath);
          } catch (renameError) {
            return fail(renameError);
          }
          settled = true;
          report();
          resolve({ bytes: downloaded, total });
        });
      });
      response.pipe(file);
    });
    request.on('error', fail);
    request.setTimeout?.(timeoutMs, () => request.destroy(new Error('视频下载连接超时')));
  });
}

module.exports = { downloadVideoToFile };
