import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['dist', 'node_modules', '.git', '.planner-dev']);

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const files = await walk(root);
const jsFiles = files.filter(file => /\.(?:js|mjs)$/.test(file));
const runtimeFiles = jsFiles.filter(file => {
  const rel = relative(root, file).replaceAll('\\', '/');
  return rel === 'app.js' || rel.startsWith('src/');
});
const failures = [];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${relative(root, file)}: ${result.stderr.trim() || 'syntax check failed'}`);
  }
}

for (const file of runtimeFiles) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const source = await fs.readFile(file, 'utf8');
  const rules = [
    [/\bdebugger\b/g, 'debugger statement'],
    [/console\.(?:log|debug)\s*\(/g, 'debug logging'],
    [/\beval\s*\(/g, 'eval()'],
    [/new\s+Function\s*\(/g, 'new Function()']
  ];
  for (const [pattern, label] of rules) {
    if (pattern.test(source)) failures.push(`${rel}: contains ${label}`);
  }
}

if (failures.length) {
  console.error(`Lint failed (${failures.length}):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Lint passed: ${jsFiles.length} JavaScript files parsed; runtime debug/eval guards clean.`);
