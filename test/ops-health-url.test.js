const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const helper = path.join(__dirname, '..', 'ops', 'health-url.sh');
const deployScript = path.join(__dirname, '..', 'ops', 'deploy.sh');
const migrateScript = path.join(__dirname, '..', 'ops', 'migrate-legacy-layout.sh');

function makeAppRoot(envContents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-health-url-'));
  fs.mkdirSync(path.join(root, 'shared'));
  if (envContents !== undefined) {
    fs.writeFileSync(path.join(root, 'shared', '.env'), envContents);
  }
  return root;
}

function resolveHealthUrl(root, extraEnv = {}) {
  const env = { ...process.env };
  delete env.XMIRROR_HEALTH_URL;
  Object.assign(env, extraEnv);

  return execFileSync(
    'bash',
    ['-c', 'source "$1"; xmirror_resolve_health_url "$2"', 'bash', helper, root],
    { encoding: 'utf8', env }
  ).trim();
}

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, `#!/usr/bin/env bash\n${contents}`);
  fs.chmodSync(filePath, 0o755);
}

function makeFakeTools() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-ops-tools-'));
  const bin = path.join(root, 'bin');
  const callLog = path.join(root, 'calls.log');
  const curlLog = path.join(root, 'curl.log');
  const sqliteRebuilt = path.join(root, 'sqlite-rebuilt');
  fs.mkdirSync(bin);

  writeExecutable(path.join(bin, 'npm'), [
    'printf \'npm %s\\n\' "$*" >> "$FAKE_CALL_LOG"',
    'printf \'npm_config_build_from_source=%s\\n\' "${npm_config_build_from_source:-}" >> "$FAKE_CALL_LOG"',
    'if [[ "$*" == *"rebuild sqlite3 --build-from-source"* ]]; then',
    '  touch "$FAKE_SQLITE_REBUILT"',
    'fi'
  ].join('\n'));
  writeExecutable(path.join(bin, 'node'), [
    'printf \'node %s\\n\' "$*" >> "$FAKE_CALL_LOG"',
    'if [[ "$1" == */ops/check-sqlite.js ]]; then',
    '  case "${FAKE_SQLITE_MODE:-ok}" in',
    '    fail-once) [[ -f "$FAKE_SQLITE_REBUILT" ]] ;;',
    '    fail) exit 1 ;;',
    '    *) exit 0 ;;',
    '  esac',
    '  exit $?',
    'fi',
    'exec "$FAKE_REAL_NODE" "$@"'
  ].join('\n'));
  writeExecutable(path.join(bin, 'pm2'), 'printf \'pm2 %s\\n\' "$*" >> "$FAKE_CALL_LOG"\n');
  writeExecutable(path.join(bin, 'sqlite3'), 'printf \'sqlite3 %s\\n\' "$*" >> "$FAKE_CALL_LOG"\n');
  writeExecutable(path.join(bin, 'sleep'), ':\n');
  writeExecutable(path.join(bin, 'curl'), [
    'printf \'%s\\n\' "$*" >> "$FAKE_CURL_LOG"',
    'case "${FAKE_CURL_MODE:-xmirror}" in',
    '  xmirror) printf \'%s\' \'{"status":"ok","service":"xmirror"}\' ;;',
    '  other) printf \'%s\' \'{"status":"ok","service":"other"}\' ;;',
    '  legacy) printf \'%s\' \'<html>legacy service</html>\' ;;',
    '  fail) exit 22 ;;',
    'esac'
  ].join('\n'));
  // BSD mv has no -T. This test double preserves the script's atomic-replace
  // semantics while letting the Linux deployment path run on macOS CI hosts.
  writeExecutable(path.join(bin, 'mv'), [
    'if [[ "$1" == "-Tf" ]]; then',
    '  /bin/rm -f -- "$3"',
    '  exec /bin/mv -f -- "$2" "$3"',
    'fi',
    'exec /bin/mv "$@"'
  ].join('\n'));

  return { root, bin, callLog, curlLog, sqliteRebuilt };
}

function opsEnv(tools, extra = {}) {
  const env = {
    ...process.env,
    PATH: `${tools.bin}:${process.env.PATH}`,
    FAKE_CALL_LOG: tools.callLog,
    FAKE_CURL_LOG: tools.curlLog,
    FAKE_REAL_NODE: process.execPath,
    FAKE_SQLITE_REBUILT: tools.sqliteRebuilt,
    ...extra
  };
  delete env.XMIRROR_HEALTH_URL;
  return env;
}

function makeGitSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-deploy-source-'));
  fs.mkdirSync(path.join(root, 'ops'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"true"}}\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'server.js'), 'console.log("fixture");\n');
  fs.writeFileSync(path.join(root, 'ops', 'check-sqlite.js'), '// fixture sqlite check\n');
  fs.writeFileSync(
    path.join(root, 'ops', 'ecosystem.config.cjs'),
    'module.exports = { apps: [] };\n'
  );
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=XMirror Test', '-c', 'user.email=test@xmirror.local', 'commit', '--quiet', '-m', 'fixture'],
    { cwd: root }
  );
  return root;
}

test('health URL uses the numeric PORT from shared/.env', (t) => {
  const root = makeAppRoot('OTHER=value\nexport PORT = "3001" # production\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(resolveHealthUrl(root), 'http://127.0.0.1:3001/healthz');
});

test('health URL defaults to the application default port when PORT is absent', (t) => {
  const root = makeAppRoot('NODE_ENV=production\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(resolveHealthUrl(root), 'http://127.0.0.1:3000/healthz');
});

test('legacy health URL can target the root path on the resolved port', (t) => {
  const root = makeAppRoot('PORT=3001\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const env = { ...process.env };
  delete env.XMIRROR_HEALTH_URL;
  const url = execFileSync(
    'bash',
    ['-c', 'source "$1"; xmirror_resolve_health_url "$2" /', 'bash', helper, root],
    { encoding: 'utf8', env }
  ).trim();

  assert.equal(url, 'http://127.0.0.1:3001/');
});

test('explicit XMIRROR_HEALTH_URL takes priority over shared/.env', (t) => {
  const root = makeAppRoot('PORT=3001\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(
    resolveHealthUrl(root, { XMIRROR_HEALTH_URL: 'http://localhost:9000/custom' }),
    'http://localhost:9000/custom'
  );
});

test('unsafe PORT syntax is rejected instead of evaluated', (t) => {
  const root = makeAppRoot('PORT=$(printf 3001)\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(
    'bash',
    ['-c', 'source "$1"; xmirror_resolve_health_url "$2"', 'bash', helper, root],
    {
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'XMIRROR_HEALTH_URL')
      )
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported PORT value/);
});

test('health response must identify the xmirror service', () => {
  const script = [
    'source "$1"',
    'curl() { printf \'%s\' "$MOCK_RESPONSE"; }',
    'xmirror_check_health http://127.0.0.1:3000/healthz'
  ].join('; ');

  const matching = spawnSync('bash', ['-c', script, 'bash', helper], {
    env: { ...process.env, MOCK_RESPONSE: '{"status":"ok", "service": "xmirror"}' }
  });
  const unrelated = spawnSync('bash', ['-c', script, 'bash', helper], {
    env: { ...process.env, MOCK_RESPONSE: '{"status":"ok","service":"other"}' }
  });

  assert.equal(matching.status, 0);
  assert.notEqual(unrelated.status, 0);
});

test('deploy restores the previous current release when health identity fails', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-deploy-rollback-'));
  const sourceRoot = makeGitSource();
  const tools = makeFakeTools();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(tools.root, { recursive: true, force: true }));

  const previous = path.join(appRoot, 'releases', 'previous');
  fs.mkdirSync(path.join(previous, 'ops'), { recursive: true });
  fs.writeFileSync(path.join(previous, 'ops', 'ecosystem.config.cjs'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(appRoot, 'shared', 'data'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'shared', 'archives'), { recursive: true });
  fs.symlinkSync(previous, path.join(appRoot, 'current'));

  const result = spawnSync('bash', [deployScript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: opsEnv(tools, {
      FAKE_CURL_MODE: 'other',
      XMIRROR_APP_ROOT: appRoot,
      XMIRROR_SOURCE_DIR: sourceRoot,
      XMIRROR_PM2_BIN: path.join(tools.bin, 'pm2')
    })
  });

  assert.notEqual(result.status, 0);
  assert.equal(fs.readlinkSync(path.join(appRoot, 'current')), previous);
  assert.match(result.stdout, /health check failed: .*; restoring previous release/);
  assert.equal((fs.readFileSync(tools.callLog, 'utf8').match(/^pm2 start /gm) || []).length, 2);
});

test('deploy rebuilds sqlite3 from source when the prebuilt binding cannot load', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-deploy-sqlite-rebuild-'));
  const sourceRoot = makeGitSource();
  const tools = makeFakeTools();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(tools.root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(appRoot, 'shared', 'data'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'shared', 'archives'), { recursive: true });

  const result = spawnSync('bash', [deployScript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: opsEnv(tools, {
      FAKE_CURL_MODE: 'xmirror',
      FAKE_SQLITE_MODE: 'fail-once',
      XMIRROR_APP_ROOT: appRoot,
      XMIRROR_SOURCE_DIR: sourceRoot,
      XMIRROR_PM2_BIN: path.join(tools.bin, 'pm2')
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(path.join(appRoot, 'current')).isSymbolicLink(), true);
  const calls = fs.readFileSync(tools.callLog, 'utf8');
  assert.match(calls, /^npm_config_build_from_source=true$/m);
  assert.match(calls, /^npm --prefix .* rebuild sqlite3 --build-from-source$/m);
  assert.equal((calls.match(/^node .*\/ops\/check-sqlite\.js$/gm) || []).length, 2);
});

test('deploy leaves current untouched when rebuilt sqlite3 still cannot load', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-deploy-sqlite-fail-'));
  const sourceRoot = makeGitSource();
  const tools = makeFakeTools();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(tools.root, { recursive: true, force: true }));

  const previous = path.join(appRoot, 'releases', 'previous');
  fs.mkdirSync(path.join(previous, 'ops'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'shared', 'data'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'shared', 'archives'), { recursive: true });
  fs.symlinkSync(previous, path.join(appRoot, 'current'));

  const result = spawnSync('bash', [deployScript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: opsEnv(tools, {
      FAKE_SQLITE_MODE: 'fail',
      XMIRROR_APP_ROOT: appRoot,
      XMIRROR_SOURCE_DIR: sourceRoot,
      XMIRROR_PM2_BIN: path.join(tools.bin, 'pm2')
    })
  });

  assert.notEqual(result.status, 0);
  assert.equal(fs.readlinkSync(path.join(appRoot, 'current')), previous);
  const calls = fs.readFileSync(tools.callLog, 'utf8');
  assert.match(calls, /^npm --prefix .* rebuild sqlite3 --build-from-source$/m);
  assert.equal((calls.match(/^node .*\/ops\/check-sqlite\.js$/gm) || []).length, 2);
  assert.doesNotMatch(calls, /^pm2 /m);
  assert.deepEqual(
    fs.readdirSync(path.join(appRoot, 'releases')).sort(),
    ['previous']
  );
});

test('legacy migration checks the root path without requiring xmirror JSON', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-migrate-legacy-'));
  const tools = makeFakeTools();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(tools.root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(appRoot, 'server.js'), '// legacy server\n');
  fs.mkdirSync(path.join(appRoot, 'data'));
  fs.writeFileSync(path.join(appRoot, 'data', 'db.sqlite'), 'test');
  fs.mkdirSync(path.join(appRoot, 'archives'));
  fs.writeFileSync(path.join(appRoot, '.env'), 'PORT=3001\n');

  const result = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env: opsEnv(tools, {
      FAKE_CURL_MODE: 'legacy',
      XMIRROR_APP_ROOT: appRoot,
      XMIRROR_PM2_BIN: path.join(tools.bin, 'pm2')
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(path.join(appRoot, 'data')).isSymbolicLink(), true);
  assert.match(fs.readFileSync(tools.curlLog, 'utf8'), /http:\/\/127\.0\.0\.1:3001\/$/m);
  assert.doesNotMatch(fs.readFileSync(tools.curlLog, 'utf8'), /healthz/);
});

test('legacy migration restores moved runtime state when its HTTP check fails', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-migrate-rollback-'));
  const tools = makeFakeTools();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(tools.root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(appRoot, 'server.js'), '// legacy server\n');
  fs.mkdirSync(path.join(appRoot, 'data'));
  fs.writeFileSync(path.join(appRoot, 'data', 'db.sqlite'), 'test');
  fs.mkdirSync(path.join(appRoot, 'archives'));
  fs.writeFileSync(path.join(appRoot, '.env'), 'PORT=3001\n');

  const result = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env: opsEnv(tools, {
      FAKE_CURL_MODE: 'fail',
      XMIRROR_APP_ROOT: appRoot,
      XMIRROR_PM2_BIN: path.join(tools.bin, 'pm2')
    })
  });

  assert.notEqual(result.status, 0);
  assert.equal(fs.lstatSync(path.join(appRoot, 'data')).isDirectory(), true);
  assert.equal(fs.lstatSync(path.join(appRoot, 'archives')).isDirectory(), true);
  assert.equal(fs.lstatSync(path.join(appRoot, '.env')).isFile(), true);
  assert.equal(fs.existsSync(path.join(appRoot, 'shared', 'data')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'shared', 'archives')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'shared', '.env')), false);
  assert.match(result.stdout, /health check failed: .*; restoring legacy layout/);
});
