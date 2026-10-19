#!/usr/bin/env node
'use strict';
// note-check <file|folder>... [--strict]
// Validates every note that uses the layered format (has a "## Now" section). Older notes are counted, not failed,
// unless --strict is given. Exit code 1 when any checked note has an error.
const fs = require('fs');
const { parse } = require('./lib/note-format');
const { validateNote: validate } = require('./lib/note-log'); // layout rules + Log rules + generated parts current
const { collect } = require('./lib/note-files');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) { console.error('usage: note-check <file|folder>... [--strict]'); process.exit(2); }

let adopted = 0;
let legacy = 0;
let bad = 0;
for (const t of targets) {
  for (const f of collect(t)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!parse(text).sections.some((s) => s.key === 'now')) {
      legacy++;
      if (strict) { bad++; console.log(`FAIL ${f}\n     not in the layered format (no "## Now")`); }
      continue;
    }
    adopted++;
    const r = validate(text);
    if (r.errors.length) { bad++; console.log(`FAIL ${f}\n${r.errors.map((e) => '     - ' + e).join('\n')}`); }
    else console.log(`ok   ${f}  (Now ${r.nowLines} lines, ${r.sections.length} sections)`);
    for (const w of r.warnings) console.log(`     warning: ${w}`);
  }
}
console.log(`\n${adopted} layered note(s) checked, ${legacy} older note(s) ${strict ? 'failed as not migrated' : 'not migrated yet'}, ${bad} failing`);
process.exit(bad ? 1 : 0);
