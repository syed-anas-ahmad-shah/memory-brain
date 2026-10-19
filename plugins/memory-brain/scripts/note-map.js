#!/usr/bin/env node
'use strict';
// note-map <file|folder> [--write]
// Prints the generated Map of a layered note. With --write it rewrites the Map section in place.
// A folder is scanned for notes that already have a "## Now" section; older notes are left alone.
const fs = require('fs');
const { withMap, parse } = require('./lib/note-format');
const { collect } = require('./lib/note-files');

const args = process.argv.slice(2);
const write = args.includes('--write');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) { console.error('usage: note-map <file|folder> [--write]'); process.exit(2); }

let changed = 0;
let skipped = 0;
for (const t of targets) {
  for (const f of collect(t)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!parse(text).sections.some((s) => s.key === 'now')) { skipped++; continue; }
    const out = withMap(text);
    if (write) {
      if (out !== text) { fs.writeFileSync(f, out); changed++; console.log('map updated: ' + f); }
    } else {
      const p = parse(out);
      const m = p.sections.find((s) => s.key === 'map');
      console.log(`# ${f}\n${m.body.join('\n')}\n`);
    }
  }
}
if (write) console.log(`${changed} note(s) updated, ${skipped} older note(s) skipped (no "## Now")`);
