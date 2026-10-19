#!/usr/bin/env node
// Memory Brain: regenerates <brain>/CATALOG.md (one line per note, every folder, archive last).
// Usage: node make-catalog.js [--brain DIR]. Read-only except for CATALOG.md.
'use strict';
const fs = require('fs');
const path = require('path');
const { load, noteFiles } = require('./lib/config');

function build(brain) {
  const rows = noteFiles(brain).filter((n) => n.dir !== '').map((n) => {
    const t = fs.readFileSync(n.full, 'utf8');
    const m = t.match(/^description:\s*"?(.*?)"?\s*$/m);
    let desc = (m ? m[1] : '').replace(/\\\\/g, '\\').replace(/\s+/g, ' ');
    if (desc.length > 105) desc = desc.slice(0, 102) + '...';
    return { dir: n.dir, file: n.name, kb: (n.size / 1024).toFixed(1).replace(/\.0$/, ''), desc };
  });
  const dirs = [...new Set(rows.map((r) => r.dir))].sort((a, b) => (a === 'archive') - (b === 'archive') || a.localeCompare(b));
  const day = new Date().toISOString().slice(0, 10);
  const out = [`# Catalog of every memory file (${rows.length})`, '', `One line per file. Live = loaded on demand; archive = old or finished (full originals of shortened files are in archive/full/). Generated ${day}.`, ''];
  for (const d of dirs) {
    const inDir = rows.filter((r) => r.dir === d).sort((a, b) => a.file.localeCompare(b.file, undefined, { sensitivity: 'base' }));
    out.push(`## ${d} (${inDir.length})`, '');
    for (const r of inDir) out.push(`- \`${d}/${r.file}\` (${r.kb} KB) - ${r.desc}`);
    out.push('');
  }
  fs.writeFileSync(path.join(brain, 'CATALOG.md'), out.join('\n'));
  return rows.length;
}

module.exports = { build };

if (require.main === module) {
  const i = process.argv.indexOf('--brain');
  const brain = i > 0 ? path.resolve(process.argv[i + 1]) : load().brain_dir;
  if (!brain) { console.log('No memory folder configured: run /memory-brain:setup or pass --brain DIR'); process.exit(1); }
  console.log(`catalog: ${build(brain)} files`);
}
