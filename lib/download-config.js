// Where media downloads go. Production: the Cloudflare Worker owns /dl (workers/download-proxy).
// If the Worker misbehaves, set DOWNLOAD_VIA=node and restart: the page then points at the Node
// proxy on /node-dl, which the Worker route (xput.app/dl*) does not match, so no Cloudflare change
// is needed. Set it back to worker (or unset it) to return.
//
//   DOWNLOAD_VIA=worker   pages use /dl (served by the Worker); Node does not serve a proxy
//   DOWNLOAD_VIA=node     pages use /node-dl, served by lib/download-proxy.js
//   (unset)               production -> worker; otherwise Node proxy on /dl and /node-dl (local use)
//   DOWNLOAD_PROXY_BASE   overrides the URL the pages use (e.g. a local `wrangler dev`)
const NODE_PATH = '/node-dl';

function resolveDownloadConfig(env = process.env) {
  const raw = String(env.DOWNLOAD_VIA || '').trim().toLowerCase();
  if (raw && !['worker', 'node'].includes(raw)) throw new Error(`DOWNLOAD_VIA must be "worker" or "node" (got "${env.DOWNLOAD_VIA}")`);
  const production = env.NODE_ENV === 'production';
  let via = raw;
  if (!via) via = env.ENABLE_LOCAL_DOWNLOAD_PROXY !== undefined ? (env.ENABLE_LOCAL_DOWNLOAD_PROXY === 'true' ? 'node' : 'worker') : production ? 'worker' : 'node';
  // Development without an explicit choice keeps the familiar /dl.
  const devDefault = !raw && via === 'node' && !production;
  const base = env.DOWNLOAD_PROXY_BASE || (via === 'node' && !devDefault ? NODE_PATH : '/dl');
  const mountPaths = via === 'node' ? (devDefault || env.ENABLE_LOCAL_DOWNLOAD_PROXY !== undefined ? ['/dl', NODE_PATH] : [NODE_PATH, '/dl']) : [];
  return { via, base, mountPaths };
}

module.exports = { NODE_PATH, resolveDownloadConfig };
