const crypto = require('node:crypto');
function digest(post) { return crypto.createHash('sha256').update(JSON.stringify(post)).digest('hex'); }
async function migrate(store) {
  await store.run(`CREATE TABLE IF NOT EXISTS seo_rollouts(id INTEGER PRIMARY KEY,post_id INTEGER,before_json TEXT,after_hash TEXT,created_at TEXT)`);
}
async function apply(store, id, version, options={}) {
  if (!['2','3'].includes(version)) throw new Error('Invalid quality version');
  const before=await store.get('SELECT * FROM posts WHERE id=?',[id]);
  if (!before) return null;
  const snapshot=await store.run('INSERT INTO seo_rollouts(post_id,before_json,created_at) VALUES(?,?,?)',[id,JSON.stringify(before),new Date().toISOString()]);
  const changed=await store.run(`UPDATE posts SET seo_quality_version=?,seo_status='review',seo_revision=seo_revision+1
    WHERE id=? AND seo_revision=? AND content IS ? AND seo_override IS ? AND seo_blocked=?`,[version,id,before.seo_revision,before.content,before.seo_override,before.seo_blocked]);
  if (!changed.changes) throw new Error('Source changed; snapshot retained');
  const result=await store.refresh(id,options);
  const after=await store.get('SELECT * FROM posts WHERE id=?',[id]);
  // Only a still-current evaluation may be automatically rolled back.
  if (after.seo_revision===before.seo_revision+1 && after.content===before.content && after.seo_status===result.status) {
    await store.run('UPDATE seo_rollouts SET after_hash=? WHERE id=?',[digest(after),snapshot.lastID]);
  }
  return {...result,rolloutId:snapshot.lastID};
}
async function rollback(store,id) {
  const record=await store.get('SELECT * FROM seo_rollouts WHERE id=?',[id]);
  if (!record?.after_hash) throw new Error('No completed rollout snapshot');
  const current=await store.get('SELECT * FROM posts WHERE id=?',[record.post_id]);
  if (!current || digest(current)!==record.after_hash) throw new Error('Post changed since rollout; refusing rollback');
  const before=JSON.parse(record.before_json);
  // Re-evaluate current moderation rather than restoring an old allow blindly.
  const updated=await store.run(`UPDATE posts SET seo_quality_version=?,seo_status='review',seo_revision=seo_revision+1,seo_next_check=NULL
    WHERE id=? AND seo_revision=? AND content IS ? AND seo_blocked=? AND seo_override IS ?`,
  [before.seo_quality_version,current.id,current.seo_revision,current.content,current.seo_blocked,current.seo_override]);
  if (!updated.changes) throw new Error('Concurrent update; refusing rollback');
  return store.refresh(current.id);
}
module.exports={migrate,apply,rollback};
