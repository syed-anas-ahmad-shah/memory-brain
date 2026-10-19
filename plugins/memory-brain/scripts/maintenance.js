#!/usr/bin/env node
// Memory Brain: background worker started by the SessionStart hook. Runs the backup and writes ONE result line
// to <state>/last-run.txt, which the next session's badge reads. Skips if another run is active (lock < 10 min old).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { load } = require('./lib/config');

const cfg = load();
const lock = path.join(cfg.state, 'run.lock');
const out = path.join(cfg.state, 'last-run.txt');
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

try {
  if (fs.existsSync(lock) && fs.statSync(lock).mtimeMs > Date.now() - 10 * 60e3) process.exit(0);
  fs.writeFileSync(lock, String(process.pid));
} catch { process.exit(0); }

let result;
try {
  const msg = `Auto backup ${d.getFullYear()}-${stamp}`;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'backup.js'), '--message', msg], { encoding: 'utf8', env: process.env, timeout: 5 * 60e3, windowsHide: true });
  const text = `${r.stdout || ''} ${r.stderr || ''}`.replace(/\s+/g, ' ').trim();
  let m;
  if (r.status === 0 && (m = text.match(/pushed and verified: (\w{7})/))) result = `backup ok ${m[1]}`;
  else if (r.status === 0 && (m = text.match(/local only: (\w{7})/))) result = `local only ${m[1]}`;
  else if (r.status === 0 && /nothing new/.test(text) && !/pushed/.test(text)) result = 'backup: nothing new';
  else result = `BACKUP PROBLEM: ${text.slice(-160) || 'backup exited ' + r.status}`;
} catch (e) {
  result = `MAINTENANCE FAILED: ${e.message}`;
}
try { fs.writeFileSync(out, `${stamp} | ${result}\n`); } catch {}
try { fs.unlinkSync(lock); } catch {}
