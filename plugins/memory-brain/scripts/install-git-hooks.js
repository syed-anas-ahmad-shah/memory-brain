#!/usr/bin/env node
// Memory Brain: installs the pre-commit and pre-push secret guards into <repo>/.git/hooks.
// Copies secret-scan.js next to them, so the guards keep working after the plugin updates or moves.
// git does not version hooks, so this re-runs after every restore and on each background backup.
// Usage: node install-git-hooks.js [--repo DIR]
'use strict';
const fs = require('fs');
const path = require('path');
const { git, load } = require('./lib/config');

const MARK = '# memory-brain secret guard';

function install(repo) {
  const hooksDir = path.resolve(repo, git(['rev-parse', '--git-path', 'hooks'], { cwd: repo }));
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'secret-scan.js'), path.join(hooksDir, 'memory-brain-secret-scan.js'));
  const done = [];
  for (const name of fs.readdirSync(path.join(__dirname, 'git-hooks'))) {
    const dst = path.join(hooksDir, name);
    if (fs.existsSync(dst) && !fs.readFileSync(dst, 'utf8').includes(MARK)) {
      done.push(`skipped ${name}: a different hook is already there (not overwritten)`);
      continue;
    }
    // LF line endings are required for sh
    fs.writeFileSync(dst, fs.readFileSync(path.join(__dirname, 'git-hooks', name), 'utf8').replace(/\r\n/g, '\n'), { mode: 0o755 });
    done.push(`installed hook: ${name}`);
  }
  return done;
}

module.exports = { install };

if (require.main === module) {
  const i = process.argv.indexOf('--repo');
  const repo = i > 0 ? path.resolve(process.argv[i + 1]) : load().repo;
  try { for (const l of install(repo)) console.log(l); } catch (e) { console.log(`hook install failed: ${e.message}`); process.exit(1); }
}
