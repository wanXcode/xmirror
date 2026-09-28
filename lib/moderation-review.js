const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseHTML } = require('linkedom');
const { normalizeText, appendModerationLog, ModerationRejectError } = require('./moderation');

class ModerationPendingError extends Error {
  constructor() { super('内容等待人工复核，通过后请重新提交'); this.code = 'CONTENT_MODERATION_PENDING'; }
}

function createReviewService({ moderator, dataDir, logPath }) {
  const dir = path.join(dataDir, 'moderation-reviews');
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  function read(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  function save(record) {
    const file = path.join(dir, record.id + '.json');
    fs.writeFileSync(file + '.part', JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(file + '.part', file);
  }
  function log(record, source) {
    appendModerationLog(logPath, { action: record.action, stage: source, url: record.payload.url,
      authorHandle: record.payload.authorHandle, reviewId: record.id, ruleVersion: record.ruleVersion,
      category: record.category, matched: record.matched, evidence: record.evidence, reason: record.reason });
  }
  function enforce(record) {
    if (record.action === 'reject') throw new ModerationRejectError('该内容不符合收录规则', { reviewId: record.id });
    if (record.action !== 'allow') throw new ModerationPendingError();
    return record;
  }
  // Shared, read-only resolution: SEO must honor manual decisions without
  // creating review files or logs on every background evaluation.
  function resolve(payload) {
    let result;
    try { result = moderator.moderateArchivedContent(payload); }
    catch (e) {
      if (!(e instanceof ModerationRejectError)) throw e;
      result = { action: 'reject', ...e.details };
    }
    const { document } = parseHTML('<html><body></body></html>');
    document.body.innerHTML = payload.content || '';
    const links = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))].sort();
    const id = crypto.createHash('sha256').update(JSON.stringify([payload.url, payload.authorHandle, payload.authorName, normalizeText(payload.content, false), links, result.ruleVersion])).digest('hex');
    const existing = read(id);
    if (existing?.source === 'manual') return existing;
    return { id, payload, ...result, source: 'rules', existing };
  }
  async function assess(payload, { retry = false } = {}) {
    const result = resolve(payload);
    const { id, existing } = result;
    if (result.source === 'manual') { log(result, 'decision'); return enforce(result); }
    if (existing && !retry && existing.action !== 'review') { log(existing, 'decision'); return enforce(existing); }
    const record = { id, payload, action: result.action, category: result.action === 'allow' ? 'none' : 'adult',
      ruleVersion: result.ruleVersion, matched: result.matched, source: 'rules', updatedAt: new Date().toISOString() };
    if (result.action !== 'review') { if (result.action === 'reject') { save(record); log(record, 'decision'); } return enforce(record); }
    record.source = 'rules'; record.reason = '存在需要结合上下文判断的信号，等待人工复核';
    save(record); log(record, 'decision'); return enforce(record);
  }

  function decide(id, action, note) {
    if (!['allow', 'reject', 'reset'].includes(action)) throw new Error('无效审核决定');
    const record = read(id); if (!record) throw new Error('审核记录不存在，请先重新审核原文');
    if (typeof note !== 'string' || !note.trim() || note.length > 500) throw new Error('请填写不超过500字的审核理由');
    Object.assign(record, { action: action === 'reset' ? 'review' : action, source: action === 'reset' ? 'rules' : 'manual', reason: note.trim(), updatedAt: new Date().toISOString() });
    save(record); log(record, 'manual'); return record;
  }
  return { assess, read, decide, resolve };
}

function groupLogs(logs, { action = '', limit = 50 } = {}) {
  const groups = new Map();
  for (const log of logs) {
    const id = /\/(?:status|article)\/(\d+)/.exec(log.url || '')?.[1] || log.url;
    if (!id) continue;
    const old = groups.get(id);
    const count = (old?.attempts || 0) + (log.stage === 'precheck' ? 0 : 1);
    // URL prechecks cannot replace the actual content decision.
    if (old && log.stage === 'precheck') continue;
    groups.set(id, { ...log, attempts: count, reviewId: log.reviewId || undefined });
  }
  return [...groups.values()].filter(x => !action || x.action === action)
    .sort((a,b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}
module.exports = { createReviewService, groupLogs, ModerationPendingError };
