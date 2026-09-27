const path = require('node:path');

async function migrateReports(store) {
  await store.run(`CREATE TABLE IF NOT EXISTS content_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, short_code TEXT NOT NULL,
    kind TEXT NOT NULL, reason TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  )`);
}
function registerReportRoutes(app, { store, publicDir, baseUrl, requireAdmin }) {
  const attempts = new Map();
  app.get('/report', (_req, res) => res.set('X-Robots-Tag', 'noindex, follow').sendFile(path.join(publicDir, 'report.html')));
  app.post('/api/reports', async (req, res) => {
    if (req.get('origin') && req.get('origin') !== new URL(baseUrl).origin) return res.sendStatus(403);
    const body = req.body || {};
    if (body.website) return res.status(202).json({ success: true });
    let code = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^[A-Za-z0-9]{6}$/.test(code)) {
      try { const url = new URL(code); code = url.origin === new URL(baseUrl).origin ? url.pathname.slice(1) : ''; } catch { code = ''; }
    }
    const { kind, reason, contact = '' } = body;
    if (!/^[A-Za-z0-9]{6}$/.test(code) || !['copyright','privacy','other'].includes(kind) || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 2000 || typeof contact !== 'string' || contact.length > 254) return res.status(400).json({ error: '请填写有效的 XPut 存档链接、类型和 10–2000 字的说明。' });
    const now = Date.now();
    for (const [key, val] of attempts) if (val.until < now) attempts.delete(key);
    const key = req.ip;
    const rate = attempts.get(key) || { count: 0, until: now + 60000 };
    if (rate.count >= 5 || attempts.size >= 10000) return res.status(429).json({ error: '提交过于频繁，请稍后再试。' });
    rate.count++; attempts.set(key, rate);
    const post = await store.get('SELECT id,short_code FROM posts WHERE short_code=?', [code]);
    if (!post) return res.status(404).json({ error: '未找到该存档，请检查链接。' });
    const result = await store.run('INSERT INTO content_reports(post_id,short_code,kind,reason,contact) VALUES(?,?,?,?,?)', [post.id, code, kind, reason.trim(), contact.trim()]);
    res.set('Cache-Control','no-store').status(201).json({ success: true, id: result.lastID });
  });
  app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    const status = req.query.status === 'closed' ? 'closed' : 'open';
    const reports = await store.all('SELECT * FROM content_reports WHERE status=? ORDER BY id DESC LIMIT 21 OFFSET ?', [status, (page-1)*20]);
    res.set('Cache-Control','no-store').json({ reports: reports.slice(0,20), page, hasMore: reports.length>20 });
  });
  app.post('/api/admin/reports/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || !['close','block'].includes(req.body?.action)) return res.sendStatus(400);
    const report = await store.get('SELECT * FROM content_reports WHERE id=?', [id]);
    if (!report) return res.sendStatus(404);
    // Blocking removes search eligibility; deleting public access remains a separate explicit action.
    if (req.body.action === 'block') await store.override(report.post_id, null, true);
    await store.run("UPDATE content_reports SET status='closed',resolved_at=CURRENT_TIMESTAMP WHERE id=?", [id]);
    res.json({ success: true });
  });
}
module.exports = { migrateReports, registerReportRoutes };
