// Admin API for featured pages (see lib/featured.js). All routes need the admin token.
function registerFeaturedAdminRoutes(app, { service, requireAdmin }) {
  const send = (res, result) => {
    res.set('Cache-Control', 'no-store');
    const { status = 200, ...body } = result;
    return res.status(status).json(status >= 400 ? { success: false, ...body } : { success: true, ...body });
  };
  const postId = req => (/^[1-9]\d{0,9}$/.test(req.params.id) ? Number(req.params.id) : null);
  const guard = handler => async (req, res) => {
    const id = postId(req);
    if (!id) return send(res, { status: 400, error: 'invalid_id' });
    try { return send(res, await handler(id, req)); }
    catch (error) { console.error('featured admin failed:', error.message); return send(res, { status: 500, error: 'server_error' }); }
  };

  app.get('/api/admin/featured', requireAdmin, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !['draft', 'live', 'withdrawn'].includes(status)) return send(res, { status: 400, error: 'invalid_status' });
    try { return send(res, { candidates: await service.candidates(status), config: service.config }); }
    catch (error) { console.error('featured admin failed:', error.message); return send(res, { status: 500, error: 'server_error' }); }
  });
  app.get('/api/admin/featured/:id', requireAdmin, guard(id => service.describe(id)));
  app.post('/api/admin/featured/:id', requireAdmin, guard((id, req) => service.upsertContent(id, req.body)));
  app.post('/api/admin/featured/:id/review', requireAdmin, guard((id, req) => service.setReviewed(id, req.body?.reviewed === true, req.body?.note)));
  app.post('/api/admin/featured/:id/publish', requireAdmin, guard(id => service.publish(id)));
  app.post('/api/admin/featured/:id/withdraw', requireAdmin, guard(id => service.withdraw(id)));
  app.post('/api/admin/featured/:id/followers', requireAdmin, guard((id, req) => service.setFollowers(id, req.body?.followers)));
}

module.exports = { registerFeaturedAdminRoutes };
