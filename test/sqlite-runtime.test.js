const test = require('node:test');

const { checkSqliteCrud } = require('../ops/check-sqlite');

test('installed sqlite3 binding supports in-memory CRUD', async () => {
  await checkSqliteCrud();
});
