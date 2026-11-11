import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await fs.readFile(resolve(root, 'app.js'), 'utf8');
const cssFiles = ['core.css','schedule.css','week.css','stats.css','pip.css','settings.css','sync.css','horizon.css','year.css','workspace.css','guides.css','theme.css','print.css','share.css','insights.css','quarter.css','tour.css','sponsor.css','opening.css','entrance.css','../contact/contact.css'];
const css = (await Promise.all(cssFiles.map(name => fs.readFile(resolve(root, 'styles', name), 'utf8')))).join('\n');

const appLines = app.split('\n').length;
const functionCount = [...app.matchAll(/^\s{2}function\s+[\w$]+\s*\(/gm)].length;
const importantCount = (css.match(/!important/g) || []).length;
const longRuntimeLines = [];
for (const rel of ['app.js','src/features/week.js','src/features/stats.js','src/features/print.js']) {
  const lines = (await fs.readFile(resolve(root, rel), 'utf8')).split('\n');
  lines.forEach((line, index) => { if (line.length > 1500) longRuntimeLines.push(`${rel}:${index + 1} (${line.length} chars)`); });
}

const thresholds = {
  appLines: 3900,
  functionCount: 200,
  importantCount: 32,
  longRuntimeLines: 0
};

console.log('Quality baseline');
console.log(`- app.js: ${appLines} lines`);
console.log(`- app.js named functions: ${functionCount}`);
console.log(`- CSS !important declarations: ${importantCount}`);
console.log(`- runtime lines > 1500 chars: ${longRuntimeLines.length}`);
longRuntimeLines.forEach(line => console.log(`  - ${line}`));

const failures = [];
if (appLines > thresholds.appLines) failures.push(`app.js exceeds ${thresholds.appLines} lines`);
if (functionCount > thresholds.functionCount) failures.push(`app.js exceeds ${thresholds.functionCount} named functions`);
if (importantCount > thresholds.importantCount) failures.push(`CSS !important count exceeds the validated screen/print baseline (${thresholds.importantCount})`);
if (longRuntimeLines.length > thresholds.longRuntimeLines) failures.push('runtime source contains a line longer than 1500 characters');

if (failures.length) {
  console.error('Quality gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Quality gate passed (no regression beyond the validated quality baseline).');
