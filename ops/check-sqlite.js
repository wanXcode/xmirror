'use strict';

const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

function openMemoryDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function checkSqliteCrud() {
  const db = await openMemoryDatabase();

  try {
    await run(db, 'CREATE TABLE deployment_check (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const inserted = await run(db, 'INSERT INTO deployment_check (value) VALUES (?)', ['created']);
    assert.equal(inserted.lastID, 1);

    assert.deepEqual(
      await get(db, 'SELECT id, value FROM deployment_check WHERE id = ?', [inserted.lastID]),
      { id: 1, value: 'created' }
    );

    const updated = await run(db, 'UPDATE deployment_check SET value = ? WHERE id = ?', [
      'updated',
      inserted.lastID
    ]);
    assert.equal(updated.changes, 1);
    assert.deepEqual(
      await get(db, 'SELECT id, value FROM deployment_check WHERE id = ?', [inserted.lastID]),
      { id: 1, value: 'updated' }
    );

    const deleted = await run(db, 'DELETE FROM deployment_check WHERE id = ?', [inserted.lastID]);
    assert.equal(deleted.changes, 1);
    assert.deepEqual(await get(db, 'SELECT COUNT(*) AS count FROM deployment_check'), { count: 0 });
  } finally {
    await close(db);
  }
}

if (require.main === module) {
  checkSqliteCrud()
    .then(() => {
      process.stdout.write('SQLite in-memory CRUD check passed\n');
    })
    .catch((error) => {
      console.error('SQLite in-memory CRUD check failed:', error);
      process.exitCode = 1;
    });
}

module.exports = { checkSqliteCrud };
