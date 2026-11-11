// Rebuilds src/vendor/motion.js from the Motion package (motion.dev).
//
// The planner has no runtime npm dependencies, so the small part of Motion it
// uses — the WAAPI-based "mini" animate(), stagger() and spring() — is bundled
// once into a vendored ES module that ships with the app and works offline.
//
//   npm run vendor:motion            uses the pinned version below
//   npm run vendor:motion -- 13.4.2  uses a specific version
//
// Requires network access to the npm registry. Review the diff before committing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOTION_VERSION = process.argv[2] || '13.4.2';
const ESBUILD_VERSION = '0.25.10';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'planner-motion-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

try {
  writeFileSync(join(work, 'package.json'), '{"private":true,"type":"module"}\n');
  writeFileSync(join(work, 'entry.js'), "export { animate } from 'motion/mini';\nexport { stagger, spring } from 'motion';\n");
  execFileSync(npm, ['install', '--no-audit', '--no-fund', `motion@${MOTION_VERSION}`, `esbuild@${ESBUILD_VERSION}`], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
  execFileSync(npx, ['esbuild', 'entry.js', '--bundle', '--format=esm', '--minify', '--legal-comments=none', '--target=es2020', '--outfile=motion.js'], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
  const banner = `/*! Motion ${MOTION_VERSION} (https://motion.dev) — vanilla "mini" animate (WAAPI), stagger and spring.\n * Copyright (c) 2024 Motion B.V. Distributed under its MIT terms; the full notice is in THIRD_PARTY_NOTICES.md.\n * Vendored so the planner keeps working offline without a CDN or a runtime npm install. Rebuild with scripts/vendor-motion.mjs. */\n`;
  const code = readFileSync(join(work, 'motion.js'), 'utf8').trimEnd();
  writeFileSync(resolve(root, 'src/vendor/motion.js'), `${banner}${code}\n`);
  console.log(`Vendored Motion ${MOTION_VERSION} into src/vendor/motion.js`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
