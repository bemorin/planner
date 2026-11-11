import test from 'node:test';
import assert from 'node:assert/strict';
import { canAddColumn, migrationSchema, runConfigChecks, tableColumns } from '../server/admin-config.js';
import { MIGRATIONS } from '../server/config-inventory.js';

// The database checks of the configuration page (server/admin-config.js)
// against a real SQLite behind a D1-shaped stand-in: every column of
// migrations/schema.sql missing in turn, in a table with rows and in an empty one, and the
// fix the page offers run as the D1 console runs it (lines joined). The fix
// must work, never lose a row, and change nothing when it can't work.

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { DatabaseSync = null; }
const skip = DatabaseSync ? false : 'node:sqlite is not available in this Node version';

// The D1 console joins every line into one.
const joined = sql => sql.split('\n').join(' ');
const d1 = db => ({
  prepare(sql) {
    assert.match(sql, /^\s*SELECT\b/i, 'the check only reads');
    return { first: async () => db.prepare(sql).get(), all: async () => ({ results: db.prepare(sql).all() }) };
  }
});
const database = async db => (await runConfigChecks({ env: { DB: d1(db) }, fetch: async () => new Response('{}', { status: 404 }), origin: 'https://planner.example.com', now: () => Date.parse('2026-10-21T08:00:00Z') }))
  .items.filter(item => item.group === 'database');
const fresh = () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) db.exec(joined(migration.sql));
  return db;
};
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
// A value of the column's type for row `n` (distinct, so UNIQUE columns hold two rows).
const sample = (definition, n) => (/^\w+\s+INTEGER\b/i.test(definition) ? n : `v${n}`);

test('the schema applied: OK, and running it again is safe', { skip }, async () => {
  const db = fresh();
  for (const item of await database(db)) assert.equal(item.state, 'ok', `${item.name}: ${item.summary}`);
  for (const migration of MIGRATIONS) db.exec(joined(migration.sql));
  db.exec('DROP INDEX team_requests_created; DROP TABLE csp_reports;');
  const broken = Object.fromEntries((await database(db)).map(item => [item.name, item]));
  assert.equal(broken['migrations/schema.sql'].summary, 'Not fully applied. Missing: table csp_reports; index team_requests_created.');
  db.exec(joined(broken['migrations/schema.sql'].fix.copy.find(entry => entry.label.startsWith('SQL of')).text));
  for (const item of await database(db)) assert.equal(item.state, 'ok', item.name);
});

test('column names are read as names, never as types: a missing column “text” is seen beside “name TEXT”', { skip }, async () => {
  assert.deepEqual(tableColumns('CREATE TABLE reviews (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  "app version" TEXT NOT NULL, [rating] INTEGER, `name` TEXT NOT NULL DEFAULT \'a, b\',\n  created_at TEXT NOT NULL CHECK (length(created_at) > 0),\n  PRIMARY KEY (id)\n)'), ['id', 'app version', 'rating', 'name', 'created_at']);
  const db = fresh();
  db.exec('DROP TABLE reviews; CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, app_version TEXT NOT NULL, rating INTEGER, name TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL);');
  const item = (await database(db)).find(entry => entry.name === 'migrations/schema.sql');
  assert.equal(item.summary, 'Not fully applied. Missing: column reviews.text; index reviews_created.');
  assert.deepEqual([canAddColumn('mode TEXT NOT NULL DEFAULT \'\''), canAddColumn('rating INTEGER'), canAddColumn('text TEXT NOT NULL'), canAddColumn('id INTEGER PRIMARY KEY'), canAddColumn('email TEXT UNIQUE'), canAddColumn('at TEXT DEFAULT CURRENT_TIMESTAMP'), canAddColumn('x TEXT NOT NULL DEFAULT NULL')], [true, true, false, false, false, false, false]);
});

test('each column missing in turn, with rows and without: the offered fix runs, keeps every row, or changes nothing', { skip }, async t => {
  let fixed = 0;
  let refused = 0;
  for (const migration of MIGRATIONS) {
    const schema = migrationSchema(migration.sql);
    for (const table of schema.tables) {
      const lines = table.body.split('\n').map(line => line.trim().replace(/,$/, '')).filter(Boolean);
      for (const column of table.columns) {
        for (const rows of [0, 2]) {
          const label = `${table.name}.${column.name} (${rows} rows)`;
          const db = fresh();
          const rest = lines.filter(line => line !== column.definition && !(new RegExp(`\\b${column.name}\\b`).test(line) && /^(?:PRIMARY KEY|UNIQUE)/i.test(line)));
          db.exec(`DROP TABLE ${table.name}; CREATE TABLE ${table.name} (${rest.join(', ')});`);
          const kept = table.columns.filter(entry => entry !== column);
          for (let n = 1; n <= rows; n += 1) {
            db.prepare(`INSERT INTO ${table.name} (${kept.map(entry => entry.name).join(', ')}) VALUES (${kept.map(() => '?').join(', ')})`).run(...kept.map(entry => sample(entry.definition, n)));
          }
          const item = (await database(db)).find(entry => entry.name === `migrations/${migration.file}`);
          assert.equal(item.state, 'problem', label);
          assert.match(item.summary, new RegExp(`column ${table.name}\\.${column.name}\\b`), label);
          const blocks = item.fix.copy.filter(entry => entry.kind === 'sql');
          assert.match(blocks.at(-1).label, /^SQL of /, `${label}: the whole file comes last`);
          let stopped = false;
          for (const block of blocks) {
            if (/, 2 of 2$/.test(block.label) && stopped) break;
            try {
              db.exec(joined(block.text));
            } catch (error) {
              // Only the copy may fail, only with rows that can't be given a value; then nothing has changed.
              assert.match(block.label, /, 1 of 2$/, `${label}: ${block.label} → ${error.message}`);
              assert.ok(rows > 0, `${label}: the copy of an empty table can't fail (${error.message})`);
              assert.match(error.message, /NOT NULL constraint failed/, label);
              assert.match(item.fix.steps.join(' '), /that copy fails/, `${label}: the steps say it may fail`);
              assert.equal(count(db, table.name), rows, `${label}: every row is still there`);
              assert.ok(!tableColumns(db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table.name).sql).includes(column.name), `${label}: the table is as it was`);
              stopped = true;
              refused += 1;
            }
          }
          if (stopped) continue;
          const after = (await database(db)).find(entry => entry.name === `migrations/${migration.file}`);
          assert.equal(after.state, 'ok', `${label}: ${after.summary}`);
          assert.equal(count(db, table.name), rows, `${label}: every row kept`);
          if (rows && kept.length) {
            const first = kept[kept.length - 1].name;
            assert.deepEqual(db.prepare(`SELECT ${first} AS value FROM ${table.name} ORDER BY rowid`).all().map(row => row.value), [1, 2].map(n => sample(kept[kept.length - 1].definition, n)), `${label}: values kept`);
          }
          fixed += 1;
        }
      }
    }
  }
  t.diagnostic(`${fixed} fixes ran and kept every row; ${refused} copies refused, changing nothing`);
  assert.ok(fixed >= 70, `${fixed} fixes ran`);
  assert.ok(refused > 10, `${refused} copies refused safely`);
});
