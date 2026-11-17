// Google sign-in (OAuth 2.0 authorization code flow). Only openid/email/profile are requested.
// The endpoints can be overridden through the environment so tests can use a local fake.
const crypto = require('node:crypto');

function googleConfig(env = process.env, baseUrl = '') {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI || `${String(baseUrl).replace(/\/$/, '')}/auth/google/callback`,
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    userinfoUrl: env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo'
  };
}

function newState() {
  return crypto.randomBytes(24).toString('base64url');
}

function authorizeUrl(config, state) {
  const url = new URL(config.authUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  }).toString();
  return url.toString();
}

class GoogleAuthError extends Error {}

// Exchange the code, then read the profile with the access token Google just gave us over TLS.
async function profileFromCode(config, code, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const body = new URLSearchParams({
    code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code'
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(timeoutMs)
  });
  const token = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !token?.access_token) throw new GoogleAuthError('token exchange failed');
  const infoResponse = await fetchImpl(config.userinfoUrl, {
    headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(timeoutMs)
  });
  const info = await infoResponse.json().catch(() => null);
  if (!infoResponse.ok || !info?.sub) throw new GoogleAuthError('profile request failed');
  return { sub: String(info.sub), email: info.email_verified === false ? null : info.email || null, name: info.name || info.email || null, picture: info.picture || null };
}

module.exports = { GoogleAuthError, authorizeUrl, googleConfig, newState, profileFromCode };
