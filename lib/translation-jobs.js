const STRATEGY_VERSION = '1.7.0';
const MAX_TRANSLATABLE_CHARS = 100000;
const MAX_TRANSLATABLE_SEGMENTS = 1000;

function countCharacters(value) {
  return Array.from(String(value || '')).length;
}

function totalCharacters(segments) {
  return (segments || []).reduce((sum, segment) => sum + countCharacters(segment.text), 0);
}

function jobKey({ postId, targetLang, sourceHash, strategyVersion = STRATEGY_VERSION }) {
  return `${postId}:${targetLang}:${sourceHash}:${strategyVersion}`;
}

// The first batch is intentionally small so the reader sees useful content quickly.
function nextBatch(segments, { first = false } = {}) {
  const maxSegments = first ? 3 : 8;
  const maxChars = first ? 500 : 1500;
  const batch = [];
  let chars = 0;
  for (const segment of segments || []) {
    const size = countCharacters(segment.text);
    if (batch.length && (batch.length >= maxSegments || chars + size > maxChars)) break;
    batch.push(segment);
    chars += size;
    if (batch.length >= maxSegments || chars >= maxChars) break;
  }
  return batch;
}

function progress(total, completed, failed) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const done = Math.max(0, Number(completed) || 0);
  const errors = Math.max(0, Number(failed) || 0);
  return {
    total: safeTotal,
    completed: done,
    failed: errors,
    pending: Math.max(0, safeTotal - done - errors),
    percent: safeTotal ? Math.round(((done + errors) / safeTotal) * 100) : 0
  };
}

module.exports = {
  STRATEGY_VERSION,
  MAX_TRANSLATABLE_CHARS,
  MAX_TRANSLATABLE_SEGMENTS,
  countCharacters,
  totalCharacters,
  jobKey,
  nextBatch,
  progress
};
