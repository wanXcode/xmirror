const SERVICE_NAME = 'xmirror';

function createHealthPayload() {
  return {
    status: 'ok',
    service: SERVICE_NAME
  };
}

function healthzHandler(req, res) {
  return res.status(200).json(createHealthPayload());
}

function registerHealthRoute(app) {
  app.get('/healthz', healthzHandler);
}

module.exports = {
  SERVICE_NAME,
  createHealthPayload,
  healthzHandler,
  registerHealthRoute
};
