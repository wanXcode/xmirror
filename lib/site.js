const site = require('../config/site.json');

// Site settings that deployments may override with environment variables (no code change needed):
// ANALYTICS_DOMAIN / ANALYTICS_SRC (set either to an empty string to switch analytics off),
// ANALYTICS_NAME (shown in the privacy policy), CONTACT_EMAIL, SHORTCUT_URL.
function siteSettings(env = process.env) {
  const pick = (name, fallback) => (env[name] !== undefined ? env[name] : fallback);
  return {
    ...site,
    analytics: { domain: pick('ANALYTICS_DOMAIN', site.analytics.domain), src: pick('ANALYTICS_SRC', site.analytics.src) },
    analyticsName: pick('ANALYTICS_NAME', site.analyticsName || '').trim(),
    contactEmail: pick('CONTACT_EMAIL', site.contactEmail || '').trim(),
    shortcutUrl: pick('SHORTCUT_URL', site.shortcutUrl)
  };
}

module.exports = { siteSettings };
