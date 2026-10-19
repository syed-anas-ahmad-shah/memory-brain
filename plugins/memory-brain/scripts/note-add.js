#!/usr/bin/env node
'use strict';
// note-add <note file> <TAG> "text" [--closes e7] [--replaces e3] [--src path]
// Adds one dated entry to the note's Log and regenerates Now and Map. Refuses secrets; prints warnings.
// This is the command-line twin of the memory_add tool.
const fs = require('fs');
const { addEntry, TAGS } = require('./lib/note-log');

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const list = (n) => (val(n) ? val(n).split(/[,\s]+/).filter(Boolean) : []);
const flagArgs = new Set(['--closes', '--replaces', '--src']);
const pos = args.filter((a, i) => !a.startsWith('--') && !flagArgs.has(args[i - 1]));
const [file, tag, text] = pos;
if (!file || !tag || !text) { console.error(`usage: note-add <note file> <${TAGS.join('|')}> "text" [--closes e7] [--replaces e3] [--src path]`); process.exit(2); }

const r = addEntry(fs.readFileSync(file, 'utf8'), { tag, text, closes: list('--closes'), replaces: list('--replaces'), src: val('--src') });
if (!r.ok) { console.log('NOT added:\n' + r.errors.map((e) => '  - ' + e).join('\n')); process.exit(1); }
fs.writeFileSync(file, r.text);
console.log(`added ${r.entry.id} (${r.entry.tag}) to ${file}`);
for (const w of r.warnings) console.log('  warning: ' + w);
