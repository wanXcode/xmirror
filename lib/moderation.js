const fs = require('fs');
const path = require('path');

class ModerationRejectError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ModerationRejectError';
    this.code = 'CONTENT_MODERATION_REJECTED';
    this.details = details;
  }
}

function readRules(rulesPath) {
  const raw = fs.readFileSync(rulesPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeText(input = '') {
  return String(input || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHandle(input = '') {
  return String(input || '').replace(/^@+/, '').trim().toLowerCase();
}

function safeHostname(input = '') {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function extractHandleFromXUrl(input = '') {
  try {
    const parsed = new URL(input);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0].toLowerCase();
    if (first === 'i' || first === 'home' || first === 'explore' || first === 'search' || first === 'intent') return '';
    return normalizeHandle(first);
  } catch {
    return '';
  }
}

function extractLinks(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches)];
}

function matchesDomain(hostname, domainRule) {
  return hostname === domainRule || hostname.endsWith(`.${domainRule}`);
}

function buildRulesIndex(rules) {
  return {
    blockDomains: new Set((rules.blockDomains || []).map(v => String(v).toLowerCase())),
    blockHandles: new Set((rules.blockHandles || []).map(v => normalizeHandle(v))),
    blockKeywords: (rules.blockKeywords || []).map(String),
    scoreKeywords: Object.entries(rules.scoreKeywords || {}).map(([keyword, score]) => ({ keyword: String(keyword), score: Number(score) || 0 })),
    regexRules: (rules.regexRules || []).map(rule => ({
      ...rule,
      regex: new RegExp(rule.pattern, 'i')
    })),
    rejectThreshold: Number(rules.rejectThreshold) || 8
  };
}

function appendModerationLog(logPath, entry) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch (err) {
    console.error('moderation log write failed:', err.message);
  }
}

function createModerator(options = {}) {
  const rulesPath = options.rulesPath || path.join(process.cwd(), 'config', 'moderation-rules.json');
  const logPath = options.logPath || path.join(process.cwd(), 'data', 'moderation.log.jsonl');

  function loadRules() {
    return buildRulesIndex(readRules(rulesPath));
  }

  function reject(message, details) {
    throw new ModerationRejectError(message, details);
  }

  function precheckUrl(inputUrl) {
    const rules = loadRules();
    const url = String(inputUrl || '').trim();
    const hostname = safeHostname(url);
    const handle = extractHandleFromXUrl(url);
    const matched = [];

    if (handle && rules.blockHandles.has(handle)) {
      matched.push({ type: 'handle', value: handle, action: 'reject' });
      const details = { stage: 'precheck', url, hostname, handle, matched };
      appendModerationLog(logPath, { action: 'reject', ...details });
      reject('该内容不符合收录规则，无法存档', details);
    }

    for (const domain of rules.blockDomains) {
      if (hostname && matchesDomain(hostname, domain)) {
        matched.push({ type: 'domain', value: domain, action: 'reject' });
        const details = { stage: 'precheck', url, hostname, handle, matched };
        appendModerationLog(logPath, { action: 'reject', ...details });
        reject('该内容不符合收录规则，无法存档', details);
      }
    }

    appendModerationLog(logPath, { action: 'allow', stage: 'precheck', url, hostname, handle, matched: [] });
    return { action: 'allow', stage: 'precheck', matched: [] };
  }

  function moderateArchivedContent(payload = {}) {
    const rules = loadRules();
    const url = String(payload.url || '').trim();
    const authorHandle = normalizeHandle(payload.authorHandle || payload.author_handle || '');
    const authorName = String(payload.authorName || payload.author || '').trim();
    const content = String(payload.content || '').trim();
    const text = normalizeText([authorName, authorHandle, content].filter(Boolean).join(' '));
    const links = [...new Set([...(payload.extractedLinks || []), ...extractLinks(content), url].filter(Boolean))];

    const matched = [];
    let score = 0;

    if (authorHandle && rules.blockHandles.has(authorHandle)) {
      matched.push({ type: 'handle', value: authorHandle, action: 'reject' });
      const details = { stage: 'content', url, authorHandle, authorName, score, matched };
      appendModerationLog(logPath, { action: 'reject', ...details });
      reject('该内容不符合收录规则，无法存档', details);
    }

    for (const keyword of rules.blockKeywords) {
      if (text.includes(keyword)) {
        matched.push({ type: 'keyword', value: keyword, action: 'reject' });
        const details = { stage: 'content', url, authorHandle, authorName, score, matched };
        appendModerationLog(logPath, { action: 'reject', ...details });
        reject('该内容不符合收录规则，无法存档', details);
      }
    }

    for (const link of links) {
      const hostname = safeHostname(link);
      for (const domain of rules.blockDomains) {
        if (hostname && matchesDomain(hostname, domain)) {
          matched.push({ type: 'domain', value: domain, action: 'reject' });
          const details = { stage: 'content', url, authorHandle, authorName, score, matched };
          appendModerationLog(logPath, { action: 'reject', ...details });
          reject('该内容不符合收录规则，无法存档', details);
        }
      }
    }

    for (const { keyword, score: weight } of rules.scoreKeywords) {
      if (text.includes(keyword)) {
        score += weight;
        matched.push({ type: 'scoreKeyword', value: keyword, score: weight });
      }
    }

    for (const rule of rules.regexRules) {
      if (rule.regex.test(text)) {
        score += Number(rule.score) || 0;
        matched.push({ type: 'regex', value: rule.label || rule.pattern, score: Number(rule.score) || 0 });
      }
    }

    const action = score >= rules.rejectThreshold ? 'reject' : 'allow';
    const details = { stage: 'content', url, authorHandle, authorName, score, matched };
    appendModerationLog(logPath, { action, ...details });

    if (action === 'reject') {
      reject('该内容不符合收录规则，无法存档', details);
    }

    return { action, score, matched };
  }

  return {
    precheckUrl,
    moderateArchivedContent,
    ModerationRejectError
  };
}

module.exports = {
  createModerator,
  ModerationRejectError
};
