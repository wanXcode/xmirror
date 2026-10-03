const https = require('node:https');

// Local Node version of the download proxy (workers/download-proxy). It applies the
// same rules (core.mjs) and streams the same way, but runs inside this server, so it
// is meant for development and as a fallback. In production the Cloudflare Worker
// serves /dl and this route is switched off (ENABLE_LOCAL_DOWNLOAD_PROXY).
let corePromise;
const loadCore = () => (corePromise ||= import('../workers/download-proxy/core.mjs'));

function createDownloadProxy({ request = https.request } = {}) {
  return async function downloadProxy(req, res) {
    const core = await loadCore();
    const parsed = core.parseDownloadRequest(new URL(req.originalUrl, 'http://localhost'), req.method);
    const send = ({ status, headers, body }) => res.status(status).set(headers).send(body);
    if (!parsed.ok) return send(parsed.response);

    const upstreamReq = request(parsed.target, {
      method: req.method,
      headers: core.upstreamHeaders(name => req.get(name)),
      timeout: 15000
    }, upstream => {
      const getHeader = name => upstream.headers[name];
      const verdict = core.checkUpstream(upstream.statusCode, getHeader);
      if (!verdict.ok) { upstream.resume(); return send(verdict.response); }
      res.status(upstream.statusCode).set(core.downloadHeaders(getHeader, parsed.filename));
      if (req.method === 'HEAD') { upstream.resume(); return res.end(); }
      upstream.pipe(res);
      upstream.on('error', () => res.destroy());
    });
    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('timeout')));
    upstreamReq.on('error', () => { if (!res.headersSent) send(core.errorResponse(502, 'UPSTREAM_UNREACHABLE', 'Could not reach X.')); else res.destroy(); });
    // Stop pulling from X as soon as the visitor goes away.
    res.on('close', () => { if (!res.writableFinished) upstreamReq.destroy(); });
    upstreamReq.end();
  };
}

module.exports = { createDownloadProxy };
