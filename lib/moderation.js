const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');

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

function normalizeText(input = '', stripUrls = true) {
  const { document } = parseHTML('<html><body></body></html>');
  document.body.innerHTML = String(input || '');
  document.querySelectorAll('script,style').forEach(node => node.remove());
  const text = document.body.textContent;
  return (stripUrls ? text.replace(/https?:\/\/[^\s<>]+/gi, ' ') : text).replace(/\s+/g, ' ').trim();
}

function normalizeHandle(input = '') {
  return String(input || '').replace(/^@+/, '').trim().toLowerCase();
}

function keywordMatches(text, keyword) {
  const value = String(keyword || '');
  // English moderation terms must be whole words. Otherwise technical words
  // such as "analysis" accidentally contain and trigger the term "anal".
  if (/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/.test(value)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'i').test(String(text || ''));
  }
  return String(text || '').includes(value);
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
    version: rules.version,
    reviewKeywords: rules.reviewKeywords || [],
    adultTags: rules.adultTags || [],
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
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch (err) {
    console.error('moderation log write failed:', err.message);
  }
}

function createModerator(options = {}) {
  const rulesPath = options.rulesPath || path.join(process.cwd(), 'config', 'moderation-rules.json');
  const logPath = options.logPath === null ? null : options.logPath || path.join(process.cwd(), 'data', 'moderation.log.jsonl');

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
    const text = normalizeText(content);
    const links = [...new Set([...(payload.extractedLinks || []), ...extractLinks(content), url].filter(Boolean))];

    const matched = [];
    let score = 0;

    if (authorHandle && rules.blockHandles.has(authorHandle)) {
      matched.push({ type: 'handle', value: authorHandle, action: 'reject' });
      const details = { stage: 'content', ruleVersion: rules.version, category: 'adult', url, authorHandle, authorName, score, matched };
      appendModerationLog(logPath, { action: 'reject', ...details });
      reject('该内容不符合收录规则，无法存档', details);
    }

    for (const keyword of rules.blockKeywords) {
      if (keywordMatches(text, keyword)) {
        matched.push({ type: 'keyword', field: 'content', value: keyword, evidence: text.slice(Math.max(0, text.toLowerCase().indexOf(keyword.toLowerCase()) - 45), text.toLowerCase().indexOf(keyword.toLowerCase()) + keyword.length + 70), action: 'reject' });
        const details = { stage: 'content', ruleVersion: rules.version, category: 'adult', url, authorHandle, authorName, score, matched };
        appendModerationLog(logPath, { action: 'reject', ...details });
        reject('该内容不符合收录规则，无法存档', details);
      }
    }

    for (const link of links) {
      const hostname = safeHostname(link);
      for (const domain of rules.blockDomains) {
        if (hostname && matchesDomain(hostname, domain)) {
          matched.push({ type: 'domain', value: domain, action: 'reject' });
          const details = { stage: 'content', ruleVersion: rules.version, category: 'adult', url, authorHandle, authorName, score, matched };
          appendModerationLog(logPath, { action: 'reject', ...details });
          reject('该内容不符合收录规则，无法存档', details);
        }
      }
    }

    // Independent signals, never add the same keyword and regex twice.
    for (const rule of rules.regexRules) {
      const hit = text.match(rule.regex);
      if (hit) matched.push({ type: 'regex', field: 'content', value: rule.label, evidence: hit[0], action: 'reject' });
    }
    for (const keyword of rules.reviewKeywords) {
      if (keywordMatches(text, keyword)) {
        const at = text.toLowerCase().indexOf(keyword.toLowerCase());
        matched.push({ type: 'context', field: 'content', value: keyword,
          evidence: text.slice(Math.max(0, at - 45), at + keyword.length + 70) });
      }
    }
    const tags = [...text.matchAll(/[#＃]([\p{L}\p{N}_]+)/gu)].map(m => m[1].toLowerCase());
    for (const tag of new Set(tags)) {
      if (rules.adultTags.includes(tag)) matched.push({ type: 'tag', field: 'content', value: tag, evidence: '#' + tag });
    }
    const action = matched.some(m => m.action === 'reject') ? 'reject' : matched.length ? 'review' : 'allow';
    const details = { stage: 'content', ruleVersion: rules.version, category: action === 'allow' ? 'none' : 'adult', url, authorHandle, authorName, score, matched };
    appendModerationLog(logPath, { action, ...details });

    if (action === 'reject') {
      reject('该内容不符合收录规则，无法存档', details);
    }

    return { action, score, matched, ruleVersion: rules.version, text };
  }

  return {
    precheckUrl,
    moderateArchivedContent,
    ModerationRejectError
  };
}

module.exports = {
  createModerator,
  ModerationRejectError, normalizeText, appendModerationLog
};
