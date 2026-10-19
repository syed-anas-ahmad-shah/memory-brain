#!/usr/bin/env node
'use strict';
// note-gen <file|folder>... [--write] [--index BRAIN_DIR] [--cwd FOLDER]
// Recomputes the generated parts of notes that have a "## Log": the Now block and the Map.
//   without --write: reports notes whose generated parts are stale (exit 1 if any)
//   with --write   : rewrites them
// With --index BRAIN_DIR it also computes the project index block and puts it into BRAIN_DIR/MEMORY.md
// (printed, or written with --write). --cwd ranks the projects for that folder first.
const fs = require('fs');
const path = require('path');
const { withGenerated, parseLog } = require('./lib/note-log');
const { collect } = require('./lib/note-files');
const { projects, renderIndex, updateIndexBlock } = require('./lib/note-index');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const skip = new Set([val('--index'), val('--cwd')].filter(Boolean));
const write = flag('--write');
const targets = args.filter((a) => !a.startsWith('--') && !skip.has(a));
const indexDir = val('--index');
if (!targets.length && !indexDir) { console.error('usage: note-gen <file|folder>... [--write] [--index BRAIN_DIR] [--cwd FOLDER]'); process.exit(2); }

let stale = 0;
let checked = 0;
for (const t of targets) {
  for (const f of collect(t)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!parseLog(text).has) continue;
    checked++;
    let out;
    try { out = withGenerated(text); } catch (e) { console.log(`FAIL ${f}: ${e.message}`); stale++; continue; }
    if (out.replace(/\s+$/, '') === text.replace(/\s+$/, '')) continue;
    if (write) { fs.writeFileSync(f, out); console.log('regenerated: ' + f); }
    else { stale++; console.log('stale (run with --write): ' + f); }
  }
}
if (targets.length) console.log(`${checked} note(s) with a Log, ${write ? 'written' : stale + ' stale'}`);

if (indexDir) {
  const block = renderIndex(projects(indexDir), { cwd: val('--cwd') || '' });
  const memory = path.join(indexDir, 'MEMORY.md');
  if (write) {
    const text = fs.existsSync(memory) ? fs.readFileSync(memory, 'utf8') : '';
    const next = updateIndexBlock(text, block);
    if (next !== text) { fs.writeFileSync(memory, next); console.log('index block updated in ' + memory); } else console.log('index block already current');
  } else console.log(block);
}
process.exit(stale ? 1 : 0);
