#!/usr/bin/env node
// Memory Brain: Stop hook. Appends one line per reply to <repo>/log/session-log.tsv
// (time, session id, working folder). Zero tokens, never blocks, never prints.
'use strict';
const fs = require('fs');
const path = require('path');

let input = '';
const done = () => {
  try {
    const { load } = require('./lib/config');
    const cfg = load();
    if (!cfg.brain_dir) return;
    let ev = {};
    try { ev = JSON.parse(input); } catch {}
    const clean = (s) => String(s || '').replace(/[\t\r\n]/g, ' ');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const dir = path.join(cfg.repo, 'log');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'session-log.tsv'), `${ts}\t${clean(ev.session_id)}\t${clean(ev.cwd)}\n`);
  } catch {}
};
const finish = () => { done(); process.exit(0); };
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', finish);
process.stdin.on('error', finish);
setTimeout(finish, 2000).unref();
