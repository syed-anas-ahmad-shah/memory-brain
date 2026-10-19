#!/usr/bin/env node
// Memory Brain: scan, check, commit (if changed) and push the memory repo to the configured backup address.
// Any git host works. With no backup address it only commits locally. With gh_account set, it pushes with
// that GitHub CLI login's token (for machines where git's saved login is a different account). Never prints a token.
// Usage: node backup.js [--message TEXT]   exit 0 = done, 1 = failed (nothing pushed)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { load, git } = require('./lib/config');
const { scan } = require('./secret-scan');
const { check } = require('./memory-check');
const { install } = require('./install-git-hooks');

const i = process.argv.indexOf('--message');
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const message = i > 0 ? process.argv[i + 1] : `Backup ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// git credentials for push / ls-remote / clone: plain git, or the chosen gh account's token
function credentials(cfg) {
  if (!cfg.gh_account) return { args: [], env: process.env, token: '' };
  let token = '';
  try { token = execFileSync('gh', ['auth', 'token', '-u', cfg.gh_account], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (!token) throw new Error(`gh login for "${cfg.gh_account}" missing: run gh auth login as ${cfg.gh_account}`);
  return { args: ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'], env: { ...process.env, GH_TOKEN: token }, token };
}

function run(cfg) {
  if (!cfg.brain_dir) throw new Error('no memory folder configured: run /memory-brain:setup');
  const repo = cfg.repo;
  try { git(['rev-parse', '--is-inside-work-tree'], { cwd: repo }); } catch { throw new Error(`${repo} is not a git repo: run /memory-brain:setup`); }

  try { install(repo); } catch (e) { console.log(`warning: git hooks not installed (${e.message})`); }
  const s = scan({ repo });
  if (s.findings.length) throw new Error(`secret scan failed (${s.findings.map((f) => f.split('  ')[0]).join(', ')}) - nothing committed or pushed`);
  // CATALOG.md is a generated list of every note: refresh it first, or the first new note would fail the health check and block the backup
  try { if (fs.existsSync(path.join(cfg.brain_dir, 'CATALOG.md'))) require('./make-catalog').build(cfg.brain_dir); } catch (e) { console.log(`warning: catalog not refreshed (${e.message})`); }
  const failed = check(cfg.brain_dir).filter((r) => !r.ok);
  if (failed.length) throw new Error(`memory-check failed (${failed.map((r) => r.name).join('; ')}) - nothing committed or pushed`);

  git(['add', '-A'], { cwd: repo });
  if (git(['status', '--porcelain'], { cwd: repo })) {
    const who = [];
    if (cfg.commit_name) who.push('-c', `user.name=${cfg.commit_name}`);
    if (cfg.commit_email) who.push('-c', `user.email=${cfg.commit_email}`);
    git([...who, 'commit', '-q', '-m', message], { cwd: repo });
    console.log(`committed: ${message}`);
  } else console.log('nothing new to commit');
  const local = git(['rev-parse', 'HEAD'], { cwd: repo });

  if (!cfg.backup_remote) { console.log(`local only: ${local}`); return; }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo });
  const c = credentials(cfg);
  const hide = (t) => (c.token ? String(t).split(c.token).join('***') : String(t));
  try {
    git([...c.args, 'push', '-q', cfg.backup_remote, `HEAD:refs/heads/${branch}`], { cwd: repo, env: c.env });
  } catch (e) { throw new Error('push failed: ' + hide(e.stderr || e.message).trim().slice(-200)); }
  let remote = '';
  try { remote = git([...c.args, 'ls-remote', cfg.backup_remote, `refs/heads/${branch}`], { cwd: repo, env: c.env }).split(/\s/)[0]; } catch (e) { throw new Error('verify failed: ' + hide(e.stderr || e.message).trim().slice(-200)); }
  if (remote !== local) throw new Error(`remote head ${remote || '(none)'} != local head ${local}`);
  console.log(`pushed and verified: ${local}`);
}

module.exports = { run, credentials };

if (require.main === module) {
  try { run(load()); process.exit(0); } catch (e) { console.log(`BACKUP FAILED: ${e.message}`); process.exit(1); }
}
