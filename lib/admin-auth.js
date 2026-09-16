function createAdminGuard(adminToken) {
  return function requireAdmin(req, res, next) {
    if (!adminToken) {
      return res.status(503).json({ error: '后台未配置 MODERATION_ADMIN_TOKEN' });
    }

    const token = req.get('x-admin-token');
    if (token !== adminToken) {
      return res.status(403).json({ error: '无权限访问后台' });
    }

    return next();
  };
}

module.exports = { createAdminGuard };
