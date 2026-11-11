import { promises as fs } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['dist', 'node_modules', '.git', '.planner-dev']);
const textExtensions = /\.(?:js|mjs|css|html|md|json|webmanifest|yml|yaml)$/;

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (textExtensions.test(entry.name) || entry.name === 'LICENSE') files.push(full);
  }
  return files;
}

const failures = [];
const files = await walk(root);
for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const text = await fs.readFile(file, 'utf8');
  if (text.includes('\r')) failures.push(`${rel}: use LF line endings`);
  if (text && !text.endsWith('\n')) failures.push(`${rel}: missing final newline`);
  if (text.includes('\t')) failures.push(`${rel}: contains tab indentation`);
  if (!rel.endsWith('.md')) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) failures.push(`${rel}:${index + 1}: trailing whitespace`);
    });
  }
}

if (failures.length) {
  console.error(`Format check failed (${failures.length}):`);
  failures.slice(0, 50).forEach(failure => console.error(`- ${failure}`));
  if (failures.length > 50) console.error(`- …and ${failures.length - 50} more`);
  process.exit(1);
}

console.log(`Format check passed: ${files.length} text files match repository whitespace conventions.`);
