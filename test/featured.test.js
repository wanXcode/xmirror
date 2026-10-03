const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { migrateFrontendSchema } = require('../lib/frontend-schema');
const { createPostStore } = require('../lib/post-store');
const { checkAiContent, createFeaturedService, evaluateGates, loadFeaturedConfig, similarity, validateInput } = require('../lib/featured');

const config = { ...loadFeaturedConfig(), minInteractions: 20, minFollowers: 1000, dailyCap: 2 };
const GOOD = {
  ai_title: 'Jack says the roadmap changes next quarter – Oct 2026',
  topic: 'Product roadmap',
  summary: 'Jack announces that the product roadmap will change next quarter, with the new editor shipping first and the mobile app following later in the year.',
  context: 'The announcement follows weeks of user feedback about the editor and comes just before the company holds its annual planning meeting.',
  key_points: ['The editor ships first', 'The mobile app follows later', 'Feedback drove the change']
};

async function setup() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (error) { return error ? reject(error) : resolve(this); }));
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => (error ? reject(error) : resolve(rows))));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row))));
  await run(`CREATE TABLE posts (id INTEGER PRIMARY KEY, short_code TEXT, author TEXT, author_handle TEXT, content TEXT, images TEXT, video_poster TEXT, tweet_time TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, seo_status TEXT, seo_blocked INTEGER DEFAULT 0)`);
  await run("CREATE TABLE content_reports (id INTEGER PRIMARY KEY, post_id INTEGER, status TEXT)");
  await migrateFrontendSchema({ run, all, get });
  const api = { get, all, run };
  const store = createPostStore(api);
  let clock = new Date('2026-10-05T12:00:00Z');
  const service = createFeaturedService({ db: api, store, config, now: () => clock });
  let n = 0;
  const addPost = async (extra = {}) => {
    n += 1;
    const post = { id: n, short_code: `P${String(n).padStart(5, '0')}`, author: 'Jack', author_handle: 'jack', content: 'We are changing the roadmap next quarter.', images: '[]', tweet_time: '2026-10-01T10:00:00Z', view_count: 30, share_count: 5, author_followers: 5000, ...extra };
    const keys = Object.keys(post);
    await run(`INSERT INTO posts(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(k => post[k]));
    return post;
  };
  return { db, run, all, get, store, service, addPost, setClock: date => { clock = date; }, close: () => db.close() };
}

test('summaries that merely repeat the post, and thin content, fail the quality check', () => {
  const post = 'We are changing the roadmap next quarter and the editor ships first, then the mobile app follows later in the year.';
  assert.deepEqual(checkAiContent({ ...GOOD, key_points: JSON.stringify(GOOD.key_points), needs_fix: 0 }, post, config), []);
  const problems = overrides => checkAiContent({ ...GOOD, key_points: JSON.stringify(GOOD.key_points), needs_fix: 0, ...overrides }, post, config);
  assert.ok(problems({ summary: post }).includes('summary_repeats_post'));
  assert.ok(problems({ summary: 'We are changing the roadmap next quarter and the editor ships first, then the mobile app follows later in the year, really.' }).includes('summary_repeats_post'));
  assert.ok(problems({ summary: 'Too short.' }).includes('summary_too_short'));
  assert.ok(problems({ context: '' }).includes('context_too_short'));
  assert.ok(problems({ ai_title: 'Hi' }).includes('ai_title_missing'));
  assert.ok(problems({ key_points: JSON.stringify(['one', 'two']) }).includes('key_points_missing'));
  assert.ok(problems({ key_points: JSON.stringify(['same', 'Same', 'other point here']) }).includes('key_points_repeat'));
  assert.ok(problems({ needs_fix: 1 }).includes('flagged_for_fixes'));
  assert.ok(similarity('the editor ships first', 'completely different words here') < 0.2);
  assert.equal(similarity('', 'x'), 0);
  assert.ok(similarity('编辑器先发布', '编辑器将先发布，随后是手机应用') > 0.5, 'CJK text is compared by characters');
});

test('input validation: required fields, length limits, and 3 to 5 key points', () => {
  assert.deepEqual(validateInput(GOOD, config).errors, []);
  assert.deepEqual(validateInput({ ...GOOD, key_points: [' a ', '', 'b', 'c'] }, config).value.key_points, ['a', 'b', 'c']);
  assert.ok(validateInput({ ...GOOD, ai_title: '' }, config).errors.includes('ai_title_required'));
  assert.ok(validateInput({ ...GOOD, summary: 'x'.repeat(config.limits.summary + 1) }, config).errors.includes('summary_too_long'));
  assert.ok(validateInput({ ...GOOD, key_points: ['a', 'b'] }, config).errors.includes('key_points_count'));
  assert.ok(validateInput({ ...GOOD, key_points: ['a', 'b', 'c', 'd', 'e', 'f'] }, config).errors.includes('key_points_count'));
  assert.ok(validateInput({ ...GOOD, key_points: 'nope' }, config).errors.includes('key_points_count'));
  assert.ok(validateInput({ ...GOOD, key_points: ['a', 'b', 'x'.repeat(config.limits.keyPoint + 1)] }, config).errors.includes('key_point_too_long'));
});

test('every gate is reported by name', () => {
  const post = { content: 'text', view_count: 1, share_count: 0, author_followers: null, sensitive: 1, seo_blocked: 1 };
  const verdict = evaluateGates({ post, row: null, openReport: true, config });
  assert.equal(verdict.passed, false);
  for (const reason of ['not_enough_interactions', 'followers_unknown', 'sensitive', 'blocked', 'open_report', 'no_content']) assert.ok(verdict.reasons.includes(reason), reason);
  const few = evaluateGates({ post: { ...post, author_followers: 10, sensitive: 0, seo_blocked: 0, view_count: 50 }, row: null, openReport: false, config });
  assert.ok(few.reasons.includes('not_enough_followers'));
  assert.ok(!few.reasons.includes('not_enough_interactions'));
});

test('workflow: content, human review, then publish; edits take a live page back to draft', async t => {
  const s = await setup();
  t.after(s.close);
  const post = await s.addPost();

  const created = await s.service.upsertContent(post.id, GOOD);
  assert.equal(created.status, 200);
  assert.equal(created.featured.status, 'draft');
  assert.equal(created.featured.lang, 'en');
  assert.deepEqual(created.gates.reasons, ['not_reviewed']);

  const refused = await s.service.publish(post.id);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.reasons, ['not_reviewed']);

  await s.service.setReviewed(post.id, true, 'spot checked');
  const live = await s.service.publish(post.id);
  assert.equal(live.status, 200);
  assert.equal(live.featured.status, 'live');
  assert.match(live.featured.live_at, /^2026-\d\d-\d\dT/);
  assert.equal((await s.service.pageFor(await s.get('SELECT * FROM posts WHERE id=?', [post.id]))).ai_title, GOOD.ai_title);

  const edited = await s.service.upsertContent(post.id, { ...GOOD, summary: `${GOOD.summary} Edited.` });
  assert.equal(edited.featured.status, 'draft', 'an edit needs a new review');
  assert.equal(edited.featured.reviewed, 0);
  assert.equal(await s.service.pageFor(await s.get('SELECT * FROM posts WHERE id=?', [post.id])), null);
});

test('Chinese posts get Chinese AI content settings; unsupported languages fall back to English', async t => {
  const s = await setup();
  t.after(s.close);
  const zh = await s.addPost({ content: '我们下个季度将调整产品路线图，编辑器会最先发布。' });
  const ja = await s.addPost({ content: 'ロードマップを変更します。' });
  assert.equal((await s.service.upsertContent(zh.id, GOOD)).featured.lang, 'zh');
  assert.equal((await s.service.upsertContent(ja.id, GOOD)).featured.lang, 'en');
});

test('the daily cap stops further pages going live that day, and resets the next day', async t => {
  const s = await setup();
  t.after(s.close);
  const posts = [await s.addPost(), await s.addPost(), await s.addPost()];
  for (const post of posts) { await s.service.upsertContent(post.id, GOOD); await s.service.setReviewed(post.id, true); }
  assert.equal((await s.service.publish(posts[0].id)).status, 200);
  assert.equal((await s.service.publish(posts[1].id)).status, 200);
  const capped = await s.service.publish(posts[2].id);
  assert.equal(capped.status, 429);
  assert.equal(capped.cap, 2);
  s.setClock(new Date('2026-10-06T08:00:00Z'));
  await s.run("UPDATE post_featured SET live_at='2026-10-05T12:00:00.000Z' WHERE status='live'");
  assert.equal((await s.service.publish(posts[2].id)).status, 200);
});

test('a live page is withdrawn when a hard stop appears: open report, blocked, sensitive', async t => {
  const s = await setup();
  t.after(s.close);
  for (const [stop, apply] of [
    ['report', post => s.run("INSERT INTO content_reports(post_id, status) VALUES(?, 'open')", [post.id])],
    ['blocked', post => s.run('UPDATE posts SET seo_blocked=1 WHERE id=?', [post.id])],
    ['sensitive', post => s.run('UPDATE posts SET sensitive=1 WHERE id=?', [post.id])]
  ]) {
    const post = await s.addPost();
    await s.service.upsertContent(post.id, GOOD);
    await s.service.setReviewed(post.id, true);
    await s.service.publish(post.id);
    s.setClock(new Date(Date.now() + 86400000 * Math.random()));
    await s.run("UPDATE post_featured SET live_at='2000-01-01T00:00:00.000Z'");
    assert.ok(await s.service.pageFor(await s.get('SELECT * FROM posts WHERE id=?', [post.id])), `${stop}: live before`);
    await apply(post);
    assert.equal(await s.service.pageFor(await s.get('SELECT * FROM posts WHERE id=?', [post.id])), null, `${stop}: page withdrawn`);
    assert.equal((await s.store.featuredFor(post.id)).status, 'withdrawn');
    assert.equal((await s.service.publish(post.id)).status, 409, `${stop}: cannot be published again`);
  }
});

test('a closed report does not block featuring, interactions and followers must reach their thresholds', async t => {
  const s = await setup();
  t.after(s.close);
  const post = await s.addPost({ view_count: 3, share_count: 2, author_followers: 200 });
  await s.run("INSERT INTO content_reports(post_id, status) VALUES(?, 'closed')", [post.id]);
  await s.service.upsertContent(post.id, GOOD);
  await s.service.setReviewed(post.id, true);
  assert.deepEqual((await s.service.publish(post.id)).reasons, ['not_enough_interactions', 'not_enough_followers']);
  await s.run('UPDATE posts SET view_count=30');
  assert.equal((await s.service.setFollowers(post.id, 2500)).status, 200);
  assert.equal((await s.service.publish(post.id)).status, 200);
  assert.equal((await s.service.setFollowers(post.id, -1)).status, 400);
  assert.equal((await s.service.setFollowers(post.id, 'many')).status, 400);
});

test('withdraw, un-review and unknown posts', async t => {
  const s = await setup();
  t.after(s.close);
  const post = await s.addPost();
  await s.service.upsertContent(post.id, GOOD);
  await s.service.setReviewed(post.id, true);
  await s.service.publish(post.id);
  assert.equal((await s.service.setReviewed(post.id, false)).featured.status, 'draft', 'taking back the review unpublishes');
  await s.service.setReviewed(post.id, true);
  await s.service.publish(post.id);
  assert.equal((await s.service.withdraw(post.id)).featured.status, 'withdrawn');
  assert.equal((await s.service.upsertContent(999, GOOD)).status, 404);
  assert.equal((await s.service.publish(999)).status, 404);
  assert.equal((await s.service.withdraw(999)).status, 404);
  assert.equal((await s.service.upsertContent(post.id, { ...GOOD, key_points: [] })).status, 400);
});

test('related pages: same author or same topic, live only, never itself, author first', async t => {
  const s = await setup();
  t.after(s.close);
  const make = async (extra, topic = 'Other') => {
    const post = await s.addPost(extra);
    await s.service.upsertContent(post.id, { ...GOOD, topic });
    await s.service.setReviewed(post.id, true);
    return post;
  };
  const main = await make({}, 'Roadmap');
  const sameAuthor = await make({}, 'Other');
  const sameTopic = await make({ author_handle: 'amy', author: 'Amy' }, 'roadmap');
  const unrelated = await make({ author_handle: 'bob', author: 'Bob' }, 'Weather');
  const draft = await make({}, 'Roadmap');
  s.setClock(new Date('2026-10-05T12:00:00Z'));
  await s.service.publish(main.id);
  await s.service.publish(sameAuthor.id);
  await s.run("UPDATE post_featured SET live_at='2026-10-04T00:00:00.000Z' WHERE post_id=?", [sameAuthor.id]);
  await s.run("UPDATE post_featured SET live_at='2026-10-03T00:00:00.000Z' WHERE post_id=?", [main.id]);
  s.setClock(new Date('2026-10-07T12:00:00Z'));
  await s.service.publish(sameTopic.id);
  s.setClock(new Date('2026-10-08T12:00:00Z'));
  await s.service.publish(unrelated.id);
  const row = await s.store.featuredFor(main.id);
  const related = await s.service.related(await s.get('SELECT * FROM posts WHERE id=?', [main.id]), row);
  assert.deepEqual(related.map(item => item.short_code), [sameAuthor.short_code, sameTopic.short_code]);
  assert.ok(!related.some(item => item.id === draft.id || item.id === main.id || item.id === unrelated.id));
});

test('the candidate list shows posts with enough interactions, or already in the pipeline, with their gates', async t => {
  const s = await setup();
  t.after(s.close);
  const busy = await s.addPost({ view_count: 50 });
  await s.addPost({ view_count: 1, share_count: 0 });
  const inPipeline = await s.addPost({ view_count: 1, share_count: 0 });
  await s.service.upsertContent(inPipeline.id, GOOD);
  const list = await s.service.candidates();
  assert.deepEqual(list.map(item => item.post.id).sort(), [busy.id, inPipeline.id].sort());
  assert.ok(list.find(item => item.post.id === busy.id).gates.reasons.includes('no_content'));
  assert.deepEqual((await s.service.candidates('draft')).map(item => item.post.id), [inPipeline.id]);
});
