const appRoot = process.env.XMIRROR_APP_ROOT || '/opt/xmirror';

module.exports = {
  apps: [{
    name: 'xmirror',
    cwd: `${appRoot}/current`,
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      DATA_DIR: `${appRoot}/shared/data`,
      ARCHIVES_DIR: `${appRoot}/shared/archives`,
      SQLITE_PATH: `${appRoot}/shared/data/db.sqlite`
    }
  }]
};
