#!/usr/bin/env node
// Memory Brain: health check for the memory folder (structure and secret-shape checks).
// No size limits on notes, the index or start-up text: big projects keep their full detail.
// Usage: node memory-check.js [--brain DIR]   (default: the configured memory folder)   exit 0 = all pass, 1 = failures
'use strict';
const fs = require('fs');
const path = require('path');
const { load, noteFiles } = require('./lib/config');

// real secret shapes only (a key header followed by key text; known token prefixes). The full scan is secret-scan.js.
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.eyJ/;

function check(brain) {
  const rows = [];
  const result = (ok, name, detail) => rows.push({ ok, name, detail });
  const read = (f) => { try { return fs.readFileSync(path.join(brain, f), 'utf8'); } catch { return null; } };

  const index = read('MEMORY.md');
  if (index === null) { result(false, 'MEMORY.md exists', `not found in ${brain}`); return rows; }
  const notes = noteFiles(brain).filter((n) => n.dir !== '');
  const names = notes.map((n) => n.name);
  result(names.length === new Set(names).size, 'no duplicate file names', `${names.length} files`);

  const cat = read('CATALOG.md');
  if (cat !== null) {
    const missing = notes.filter((n) => !cat.includes(n.name)).length;
    result(missing === 0, 'every file in CATALOG', `${missing} missing`);
  }

  const links = [...index.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l));
  const bad = links.filter((l) => !fs.existsSync(path.join(brain, l.split('#')[0]))).length;
  result(bad === 0, 'index links resolve', `${links.length} links, ${bad} broken`);

  const hits = notes.filter((n) => SECRET.test(fs.readFileSync(n.full, 'utf8'))).map((n) => n.name);
  result(hits.length === 0, 'no secret shapes in memory', `${hits.length} files: ${hits.join(', ')}`);
  return rows;
}

module.exports = { check };

if (require.main === module) {
  const i = process.argv.indexOf('--brain');
  const brain = i > 0 ? path.resolve(process.argv[i + 1]) : load().brain_dir;
  if (!brain) { console.log('No memory folder configured: run /memory-brain:setup or pass --brain DIR'); process.exit(1); }
  const rows = check(brain);
  for (const r of rows) console.log(`${(r.ok ? 'PASS' : 'FAIL').padEnd(6)} ${r.name.padEnd(34)} ${r.detail}`);
  const fail = rows.filter((r) => !r.ok).length;
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(fail ? 1 : 0);
}
