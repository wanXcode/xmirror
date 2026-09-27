const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const sqlite3 = require('sqlite3');

test('repair is dry by default, preserves other posts, and is idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-repair-'));
  const db = new sqlite3.Database(path.join(dir, 'db.sqlite'));
  const run = sql => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
  const rows = () => new Promise((resolve, reject) => db.all('SELECT * FROM posts ORDER BY id', (e, r) => e ? reject(e) : resolve(r)));
  try {
    fs.mkdirSync(path.join(dir, 'images'));
    fs.writeFileSync(path.join(dir, 'images', 'a.jpg'), 'image');
    await run(`CREATE TABLE posts(id INTEGER, short_code TEXT, content TEXT, images TEXT);
      INSERT INTO posts VALUES(1,'abcdef','','["/images/a.jpg"]'),
      (2,'ghijkl','keep','["/images/a.jpg"]'),
      (3,'mnopqr','','["/images/missing.jpg"]'),
      (4,'stuvwx','','broken');`);
    const invoke = args => execFile(process.execPath, [path.join(__dirname, '../ops/repair-image-only.js'), ...args], { env: { ...process.env, DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'db.sqlite') } });
    await invoke([]);
    assert.equal((await rows())[0].content, '');
    await invoke(['--apply']);
    const repaired = await rows();
    assert.match(repaired[0].content, /src="\/images\/a.jpg"/);
    assert.equal(repaired[0].short_code, 'abcdef');
    assert.equal(repaired[1].content, 'keep');
    assert.equal(repaired[2].content, '');
    assert.equal(repaired[3].content, '');
    await invoke(['--apply']);
    assert.deepEqual(await rows(), repaired);
  } finally {
    await new Promise(resolve => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
