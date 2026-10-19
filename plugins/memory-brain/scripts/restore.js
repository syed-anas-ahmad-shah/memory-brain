#!/usr/bin/env node
// Memory Brain: rebuild the whole memory from the backup into an EMPTY folder, then prove it.
// Usage: node restore.js --target DIR [--source URL|PATH] [--compare-with DIR] [--min-files N]
// --source defaults to the configured backup address (a URL, or a remote name of the current memory repo).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load, git } = require('./lib/config');
const { credentials } = require('./backup');
const { scan } = require('./secret-scan');
const { check } = require('./memory-check');
const { install } = require('./install-git-hooks');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function restore(cfg, { target, source, compareWith, minFiles = 1 }) {
  if (!target) throw new Error('--target DIR is required');
  target = path.resolve(target);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`target '${target}' is not empty - refusing to overwrite anything`);
  source = source || cfg.backup_remote;
  if (!source) throw new Error('no --source given and no backup address configured');
  const looksLikePlace = /^[a-z][a-z0-9+.-]*:\/\/|^[^/\\]+@[^:]+:|[/\\]/i.test(source) || fs.existsSync(source);
  if (!looksLikePlace) {
    try { source = git(['remote', 'get-url', source], { cwd: cfg.repo }); } catch { throw new Error(`'${source}' is a remote name this machine does not know: pass --source <url>`); }
  }

  const c = /^https:\/\//.test(source) ? credentials(cfg) : { args: [], env: process.env, token: '' };
  try { git([...c.args, '-c', 'core.autocrlf=false', 'clone', '-q', source, target], { env: c.env }); } catch (e) { throw new Error('clone failed: ' + String(e.stderr || e.message).split(c.token || '\0').join('***').trim().slice(-200)); }

  const rows = [];
  const step = (ok, name, detail = '') => rows.push({ ok, name, detail });
  let fsckOk = true;
  try { git(['fsck', '--full'], { cwd: target }); } catch { fsckOk = false; }
  step(fsckOk, 'git fsck (object integrity)');
  const tracked = git(['-c', 'core.quotepath=off', 'ls-files'], { cwd: target }).split('\n').filter(Boolean);
  step(tracked.length >= minFiles, 'files restored', `${tracked.length} tracked`);
  const missing = tracked.filter((f) => !fs.existsSync(path.join(target, f)));
  step(missing.length === 0, 'every tracked file on disk', `${missing.length} missing`);

  // the brain sits at the same place inside the repo as it does in the live memory repo
  const sub = cfg.brain_dir && cfg.repo ? path.relative(cfg.repo, cfg.brain_dir) : '';
  const brain = [path.join(target, sub), target, path.join(target, 'brain')].find((d) => fs.existsSync(path.join(d, 'MEMORY.md')));
  step(!!brain, 'MEMORY.md present', brain ? path.relative(target, path.join(brain, 'MEMORY.md')) : 'not found');

  if (compareWith) {
    const diff = tracked.filter((f) => { const a = path.join(compareWith, f); return !fs.existsSync(a) || hash(a) !== hash(path.join(target, f)); });
    step(diff.length === 0, 'byte-identical to original', `${diff.length} of ${tracked.length} files differ`);
    for (const f of diff.slice(0, 8)) rows.push({ note: `       differs: ${f}` });
  }
  let hooksOk = true;
  try { install(target); } catch { hooksOk = false; }
  step(hooksOk, 'git hooks reinstalled');
  step(scan({ repo: target }).findings.length === 0, 'secret scan on restored copy');
  step(!!brain && check(brain).every((r) => r.ok), 'memory-check on restored copy');
  return rows;
}

module.exports = { restore };

if (require.main === module) {
  try {
    const rows = restore(load(), { target: arg('--target'), source: arg('--source'), compareWith: arg('--compare-with'), minFiles: Number(arg('--min-files')) || 1 });
    for (const r of rows) console.log(r.note || `${(r.ok ? 'PASS' : 'FAIL').padEnd(6)} ${r.name.padEnd(32)} ${r.detail}`);
    const ok = rows.every((r) => r.note || r.ok);
    console.log(ok ? `\nRESTORE VERIFIED into ${path.resolve(arg('--target'))}` : '\nRESTORE HAS FAILURES');
    process.exit(ok ? 0 : 1);
  } catch (e) { console.log(`RESTORE FAILED: ${e.message}`); process.exit(1); }
}
