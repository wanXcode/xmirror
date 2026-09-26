const DEFAULT_PUBLIC_BASE_URL = 'https://xput.app';

function normalizePublicBaseUrl(value = DEFAULT_PUBLIC_BASE_URL) {
  const parsed = new URL(String(value).trim());

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('PUBLIC_BASE_URL must use http or https');
  }

  return parsed.origin;
}

function buildPublicUrl(relativePath, baseUrl = DEFAULT_PUBLIC_BASE_URL) {
  const base = normalizePublicBaseUrl(baseUrl);
  return new URL(relativePath, `${base}/`).toString();
}

module.exports = {
  DEFAULT_PUBLIC_BASE_URL,
  normalizePublicBaseUrl,
  buildPublicUrl
};
