#!/usr/bin/env node
// Memory Brain: secret scanner. Blocks real secret SHAPES (not plain words) in the memory repo.
// Usage: node secret-scan.js [--staged] [--repo DIR] [--allowlist FILE]   exit 0 = clean, 1 = findings, 2 = error
// --staged scans only files staged for commit (pre-commit); default scans every tracked file (pre-push, backup).
// Findings are printed MASKED (first 4 chars only). Accepted exceptions: one 'path|pattern|reason' per line in
// <repo>/.memory-brain/secret-allowlist.txt (or the older <repo>/tools/secret-allowlist.txt).
// Self-contained on purpose: install-git-hooks.js copies this file into .git/hooks.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PATTERNS = {
  'pem-private-key': /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}/g,
  'anthropic-key': /sk-ant-[A-Za-z0-9_-]{20,}/g,
  'openrouter-key': /sk-or-v1-[A-Za-z0-9]{20,}/g,
  'openai-key': /\bsk-[A-Za-z0-9]{32,}/g,
  'github-token': /\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g,
  'google-api-key': /AIza[0-9A-Za-z_-]{35}/g,
  'aws-access-key': /\bAKIA[0-9A-Z]{16}\b/g,
  'slack-token': /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  'stripe-live-key': /\b[rs]k_live_[A-Za-z0-9]{20,}/g,
  'paddle-api-key': /pdl_(live|sdbx)_apikey_[A-Za-z0-9_]{20,}/g,
  'jwt': /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g,
  'assigned-secret': /\b(secret|token|passw(or)?d|api[_-]?key)["'\s]*[:=]\s*["'`]?[A-Za-z0-9/+_=-]{24,}/gi,
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function scan({ repo, staged = false, allowlist } = {}) {
  repo = path.resolve(repo || process.cwd());
  const git = (args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = (staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM']) : git(['ls-files'])).split('\n').filter(Boolean);

  const allow = new Set();
  const allowFile = allowlist || [path.join(repo, '.memory-brain', 'secret-allowlist.txt'), path.join(repo, 'tools', 'secret-allowlist.txt')].find((f) => fs.existsSync(f));
  if (allowFile && fs.existsSync(allowFile)) {
    for (const l of fs.readFileSync(allowFile, 'utf8').split(/\r?\n/)) {
      if (/^\s*#/.test(l) || !l.includes('|')) continue;
      const [p, pat] = l.split('|');
      allow.add(`${p.trim()}|${pat.trim()}`);
    }
  }

  const findings = [];
  for (const f of files) {
    const full = path.join(repo, f);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (allow.has(`${f}|${name}`)) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split('\n').length;
        findings.push(`${f}:${line}  ${name}  starts "${m[0].slice(0, 4)}..."`);
      }
    }
  }
  return { files: files.length, findings, allowFile };
}

module.exports = { scan, PATTERNS };

if (require.main === module) {
  try {
    const r = scan({ repo: arg('--repo'), staged: process.argv.includes('--staged'), allowlist: arg('--allowlist') });
    if (r.findings.length) {
      console.log(`SECRET SCAN FAILED - ${r.findings.length} finding(s):`);
      for (const f of r.findings) console.log('  ' + f);
      console.log("Remove the secret, or (only if it is dead and the owner accepted it) add 'path|pattern|reason' to .memory-brain/secret-allowlist.txt.");
      process.exit(1);
    }
    console.log(`secret scan clean (${r.files} files)`);
    process.exit(0);
  } catch (e) {
    console.log(`SECRET SCAN ERROR: ${e.message}`);
    process.exit(2);
  }
}
