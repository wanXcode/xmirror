const { extractXPostId } = require('./x-post');

function compareOldest(a, b) {
  const aTime = Date.parse(a.created_at || '');
  const bTime = Date.parse(b.created_at || '');
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
  return Number(a.id) - Number(b.id);
}

function buildDedupePlan(posts = []) {
  const groups = new Map();
  for (const post of posts) {
    const tweetId = extractXPostId(post.url);
    if (!tweetId) continue;
    if (!groups.has(tweetId)) groups.set(tweetId, []);
    groups.get(tweetId).push(post);
  }

  return [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([tweetId, records]) => {
      const sorted = [...records].sort(compareOldest);
      return { tweetId, survivor: sorted[0], duplicates: sorted.slice(1) };
    })
    .sort((a, b) => Number(a.survivor.id) - Number(b.survivor.id));
}

function summarizeDedupePlan(plan = []) {
  return {
    groups: plan.length,
    duplicateRecords: plan.reduce((total, group) => total + group.duplicates.length, 0)
  };
}

module.exports = { buildDedupePlan, summarizeDedupePlan };
