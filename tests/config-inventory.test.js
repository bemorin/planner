import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CONFIG_CHECKS, CONFIG_GROUPS, CONFIG_VARIABLES, configVariable, LOCAL_VARIABLES, MIGRATIONS, PLATFORM_BINDINGS } from '../server/config-inventory.js';

// The inventory of every setting (server/config-inventory.js) against the code that reads them:
// a variable read but not listed, or listed but never read, fails here.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const names = list => new Set(list.map(entry => entry.name));
const inventory = names(CONFIG_VARIABLES);
const platform = names(PLATFORM_BINDINGS);
const local = names(LOCAL_VARIABLES);
const byWhere = where => CONFIG_VARIABLES.filter(entry => entry.where === where);

function walk(dir) {
  const skip = new Set(['dist', 'node_modules', '.git', '.planner-dev', 'tests']);
  return readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap(entry => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return skip.has(entry.name) || entry.name.startsWith('.') ? [] : walk(path);
    return /\.(?:js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

/** process.env.X and process.env['X'] reads of a source. */
const processEnvReads = source => new Set([...source.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g)].map(match => match[1] || match[2]));
const envNames = pattern => pattern.split(',').map(part => part.trim().replace(/^\.\.\./, '').split(/\s*[:=]\s*/)[0].trim()).filter(name => /^[A-Z][A-Z0-9_]*$/.test(name));
/**
 * The variables a source reads from a Functions or Workers environment: env.X, env?.X (context.env.X too),
 * env['X'], env?.["X"], and destructuring: const { X } = env, const { X } = context.env, { env: { X } }.
 */
function envReads(source) {
  const names = new Set();
  for (const match of source.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)\b/g)) names.add(match[1]);
  for (const match of source.matchAll(/\benv\s*(?:\?\.)?\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g)) names.add(match[2]);
  for (const match of source.matchAll(/\{([^{}]*)\}\s*=\s*(?:[\w$]+\??\.)*env\b(?!\s*\??\.)/g)) for (const name of envNames(match[1])) names.add(name);
  for (const match of source.matchAll(/\benv\s*:\s*\{([^{}]*)\}/g)) for (const name of envNames(match[1])) names.add(name);
  return names;
}

test('every build variable scripts/build.mjs reads is listed, with the runtime-config key it fills, and the other way round', () => {
  const build = read('scripts/build.mjs');
  const pairs = [...build.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*process\.env\.([A-Z][A-Z0-9_]*)\s*\|\|/gm)].map(match => [match[1], match[2]]);
  const reads = processEnvReads(build);
  assert.ok(pairs.length >= 13, `found ${pairs.length} build variables`);
  assert.equal(pairs.length, reads.size, 'every process.env read of the build fills a runtime-config key');
  for (const [key, name] of pairs) {
    const entry = configVariable(name);
    assert.ok(entry, `${name} (read by scripts/build.mjs) is missing from server/config-inventory.js`);
    assert.equal(entry.where, 'build', `${name} is a build variable`);
    assert.equal(entry.runtimeKey, key, `${name} fills ${key} in runtime-config.js`);
  }
  for (const entry of byWhere('build')) assert.ok(reads.has(entry.name), `${entry.name} is listed as a build variable but scripts/build.mjs never reads it`);
});

test('the public runtime-config.js has a blank key for every build variable, and the repository check keeps them blank', () => {
  const config = read('runtime-config.js');
  const keys = new Set([...config.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*''/gm)].map(match => match[1]));
  assert.deepEqual([...keys].sort(), byWhere('build').map(entry => entry.runtimeKey).sort());
  const blank = /for \(const key of (\[[^\]]+\])\)/.exec(read('scripts/check.mjs'))?.[1];
  assert.ok(blank, 'scripts/check.mjs lists the keys that must stay blank');
  for (const key of JSON.parse(blank.replace(/'/g, '"'))) assert.ok(keys.has(key), `${key} is a build variable`);
});

test('every variable, secret and binding the Pages Function reads is listed, and every listed one is read', () => {
  const functions = read('functions/api/[[path]].js');
  const reads = envReads(functions);
  assert.ok(reads.has('ADMIN_TOKEN') && reads.has('RESEND_API_KEY') && reads.has('DB'), [...reads].join(' '));
  for (const name of reads) {
    const entry = configVariable(name);
    assert.ok(entry || platform.has(name), `${name} (read by the Function) is missing from server/config-inventory.js`);
    if (entry) assert.ok(['runtime', 'binding'].includes(entry.where), `${name} is read at runtime`);
  }
  for (const entry of [...byWhere('runtime'), ...byWhere('binding')]) assert.ok(reads.has(entry.name), `${entry.name} is listed for the Functions but never read there`);
  assert.match(functions, /configEnv: env\b/, 'the configuration checks get the whole environment');
  // A computed read (env[name]) would escape this test: the Function names every variable it reads.
  assert.doesNotMatch(functions, /\benv\s*(?:\?\.)?\[\s*(?!['"`])/, 'the Function reads env[…] with a computed name');
});

test('every way of reading the environment is seen: dotted, bracketed, destructured', () => {
  const reads = envReads([
    'const a = env.ONE; const b = env?.TWO; void context.env.THREE;',
    "const c = env['FOUR']; const d = env?.[\"FIVE\"]; const e = env[`SIX`];",
    "const { SEVEN, EIGHT: eight, NINE = '' } = env;",
    'const { TEN } = context.env; const { request, env: { ELEVEN } } = context;',
    // Destructuring a binding reads the binding, not its fields.
    'const { request, env } = context; const { prepare } = env.DB;'
  ].join('\n'));
  assert.deepEqual([...reads].sort(), ['DB', 'EIGHT', 'ELEVEN', 'FIVE', 'FOUR', 'NINE', 'ONE', 'SEVEN', 'SIX', 'TEN', 'THREE', 'TWO']);
});

test('the server never reads process.env, and reads only listed names from an environment', () => {
  for (const file of walk('server')) {
    const source = read(file);
    assert.equal(processEnvReads(source).size, 0, `${file} reads process.env: pass the value in as an option instead`);
    for (const name of envReads(source)) assert.ok(inventory.has(name) || platform.has(name), `${file} reads env.${name}, which isn’t in server/config-inventory.js`);
  }
});

test('the browser code reads no environment: its settings come from runtime-config.js', () => {
  const files = ['app.js', ...walk('src'), ...walk('welcome'), ...walk('admin'), ...walk('contact'), ...walk('legal')];
  assert.ok(files.includes('admin/configuration/configuration.js') && files.includes('src/config.js'), 'the scan sees the pages');
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /import\.meta\.env/, `${file} reads import.meta.env`);
    assert.equal(processEnvReads(source).size, 0, `${file} reads process.env`);
  }
});

test('the local tools read production variables or the ones listed as local only, and each local one is read', () => {
  const scripts = walk('scripts');
  const seen = new Set();
  for (const file of scripts) {
    for (const name of processEnvReads(read(file))) {
      seen.add(name);
      assert.ok(inventory.has(name) || local.has(name), `${file} reads ${name}: list it in server/config-inventory.js (LOCAL_VARIABLES if it is for a computer only)`);
    }
  }
  for (const entry of LOCAL_VARIABLES) {
    assert.ok(seen.has(entry.name), `${entry.name} is listed as local but no script reads it`);
    assert.match(read(entry.readBy), new RegExp(entry.name.replace(/[()]/g, '\\$&')), `${entry.readBy} reads ${entry.name}`);
  }
  // The dev server's served runtime-config.js takes build variables by name (ENV_CONFIG): they are listed too.
  const devConfig = /const ENV_CONFIG = \[([\s\S]*?)\];/.exec(read('scripts/serve.mjs'))?.[1] || '';
  const devNames = [...devConfig.matchAll(/'(DAILY_PLANNER_[A-Z_]+)'/g)].map(match => match[1]);
  assert.ok(devNames.length >= 6);
  for (const name of devNames) assert.equal(configVariable(name)?.where, 'build', name);
});

test('each entry is complete: a known group and level, a secret is a Secret and never a build variable', () => {
  const groups = new Set(CONFIG_GROUPS.map(group => group.id));
  assert.equal(inventory.size, CONFIG_VARIABLES.length, 'names are unique');
  for (const entry of CONFIG_VARIABLES) {
    assert.ok(groups.has(entry.group), `${entry.name}: group ${entry.group}`);
    assert.ok(['required', 'recommended', 'optional'].includes(entry.level), `${entry.name}: level`);
    assert.ok(['build', 'runtime', 'binding'].includes(entry.where), `${entry.name}: where`);
    for (const field of ['source', 'unlocks', 'blocks', 'format', 'type']) assert.ok(String(entry[field] || '').trim(), `${entry.name}: ${field}`);
    if (entry.secret) assert.equal(entry.type, 'Secret', `${entry.name} is set as a Secret`);
    else assert.notEqual(entry.type, 'Secret', `${entry.name} is not a secret`);
    if (entry.where === 'build') assert.equal(entry.secret, false, `${entry.name}: build variables end up public, in runtime-config.js`);
  }
  // Each group has settings, or checks that are no setting (Security headers, 1.35).
  for (const group of CONFIG_GROUPS) assert.ok([...CONFIG_VARIABLES, ...CONFIG_CHECKS].some(entry => entry.group === group.id), `${group.id} has settings or checks`);
  for (const entry of CONFIG_CHECKS) for (const field of ['name', 'source', 'unlocks', 'blocks', 'type', 'test']) assert.ok(String(entry[field] || '').trim(), `${entry.id}: ${field}`);
  assert.deepEqual(CONFIG_VARIABLES.filter(entry => entry.secret).map(entry => entry.name).sort(), ['ADMIN_TOKEN', 'ADMIN_TOTP_SECRET', 'RESEND_API_KEY']);
  assert.deepEqual(CONFIG_VARIABLES.filter(entry => entry.generate).map(entry => `${entry.name}:${entry.generate}`).sort(), ['ADMIN_TOKEN:token', 'ADMIN_TOTP_SECRET:totp']);
  assert.deepEqual(CONFIG_GROUPS.map(group => group.id), ['build', 'functions', 'database', 'security', 'resend', 'legal']);
});

test('the schema the checks expect is migrations/schema.sql, comments aside', () => {
  assert.deepEqual(MIGRATIONS.map(migration => migration.file), ['schema.sql']);
  for (const migration of MIGRATIONS) {
    const statements = read(`migrations/${migration.file}`).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(line => line.trim()).join('\n');
    assert.equal(migration.sql, statements, `${migration.file}: copy its statements into MIGRATIONS (server/config-inventory.js)`);
    assert.ok(migration.unlocks, migration.file);
  }
});

test('the settings of the sales (1.38 and before) are gone: listed nowhere, read nowhere, blank in no config', () => {
  // The owner deletes them on Cloudflare (the release notes list them); a copy still set there is ignored.
  const gone = /^(?:CREEM_[A-Z_]+|PLUS_SIGNING_KEY|DAILY_PLANNER_(?:PLUS_PUBLIC_KEY|AFFILIATE_URL)|PLUS_PUBLIC_KEY|AFFILIATE_URL|SALES_OPEN)$/;
  // Nor the address of any outside service the sales used: every *_API_URL named is one of the planner's own.
  const ownApis = new Set(['PLANNER_API_URL', 'DAILY_PLANNER_API_URL', 'CLOUD_API_URL', 'DAILY_PLANNER_CLOUD_API_URL', 'RESEND_API_URL']);
  const retired = name => gone.test(name) || (/_API_URL$/.test(name) && !ownApis.has(name));
  assert.ok(retired('EXAMPLE_API_URL') && !retired('PLANNER_API_URL'));
  for (const name of [...inventory, ...platform, ...local, ...CONFIG_VARIABLES.map(entry => entry.runtimeKey).filter(Boolean)]) assert.equal(retired(name), false, name);
  for (const file of ['functions/api/[[path]].js', 'scripts/build.mjs', 'scripts/serve.mjs', 'scripts/check.mjs', 'runtime-config.js', ...walk('server')]) {
    const source = read(file);
    const found = [...source.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)].map(match => match[0]).filter(retired);
    assert.deepEqual(found, [], file);
  }
});

test('docs/configuration.md names every setting and every local-only variable', () => {
  const docs = read('docs/configuration.md');
  for (const entry of [...CONFIG_VARIABLES, ...LOCAL_VARIABLES]) assert.ok(docs.includes(`\`${entry.name}\``), `${entry.name} is in docs/configuration.md`);
  assert.match(read('docs/FEEDBACK_AND_WAITLIST.md'), /\(configuration\.md\)/, 'the setup guide links to it');
  // Its table “Every setting” says what the inventory says: the level, and whether it is a secret.
  const table = docs.split('## Every setting')[1].split('\n## ')[0];
  const rows = new Map();
  for (const line of table.split('\n').filter(row => /^\| `/.test(row))) {
    const [names, level, secret] = line.split('|').slice(1).map(cell => cell.trim());
    for (const [, name] of names.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) rows.set(name, { level, secret });
  }
  for (const entry of CONFIG_VARIABLES) {
    const row = rows.get(entry.name);
    assert.ok(row, `${entry.name} has a row in the table of docs/configuration.md`);
    assert.equal(row.level, entry.level, `${entry.name}: level in docs/configuration.md`);
    if (entry.where !== 'binding') assert.equal(row.secret === 'yes', entry.secret, `${entry.name}: secret in docs/configuration.md`);
  }
});
