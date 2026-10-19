#!/usr/bin/env node
'use strict';
// Memory Brain: converts an older prose note into a layered note (Log + generated Now/Map). Lossless; dry run by default.
//   node note-convert.js --list [BRAIN]                  -> older notes that have no Log yet (biggest first)
//   node note-convert.js <note.md> <spec.json>           -> dry run: shows the new Now block and the checks, changes nothing
//   node note-convert.js <note.md> <spec.json> --apply   -> backs the note up to <brain>/.convert-backup/, then writes it
// The spec is written by Claude from the note's own text (see skills/convert/SKILL.md).
const fs = require('fs');
const path = require('path');
const { load, noteFiles } = require('./lib/config');
const { parseLog } = require('./lib/note-log');
const { convert } = require('./lib/note-convert');
const { tokens } = require('./lib/note-format');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const pos = args.filter((a) => !a.startsWith('--'));
const say = (s) => console.log(s);

function list(brainArg) {
  const brain = brainArg || load().brain_dir;
  if (!brain || !fs.existsSync(brain)) { say('no memory folder: pass one, or run /memory-brain:setup'); process.exit(1); }
  const rows = noteFiles(brain).filter((n) => n.live).map((n) => {
    const t = fs.readFileSync(n.full, 'utf8');
    return { rel: path.relative(brain, n.full).replace(/\\/g, '/'), tokens: tokens(t), layered: parseLog(t).has, project: /^\s*type:\s*project\b/m.test(t.slice(0, 600)) };
  });
  const todo = rows.filter((r) => !r.layered).sort((a, b) => b.tokens - a.tokens);
  say(`${rows.length - todo.length} layered, ${todo.length} older (no Log yet). Convert the project notes first; short rules and reference notes gain little.`);
  for (const r of todo) say(`${String(r.tokens).padStart(7)} tokens  ${r.project ? 'project  ' : 'other    '}${r.rel}`);
}

function main() {
  if (args.includes('--list')) return list(pos[0]);
  const [file, specFile] = pos;
  if (!file || !specFile) { say('usage: note-convert.js --list [BRAIN] | <note.md> <spec.json> [--apply]'); process.exit(2); }
  let raw; let spec;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { say(`cannot read ${file}: ${e.message}`); process.exit(1); }
  try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')); } catch (e) { say(`cannot read the spec ${specFile}: ${e.message}`); process.exit(1); }
  if (Array.isArray(spec)) spec = spec[0];
  const r = convert(raw, spec, { fallbackDate: new Date(fs.statSync(file).mtimeMs) });
  for (const w of r.warnings) say(`warning: ${w}`);
  if (!r.ok) { say(`NOT CONVERTED:\n${r.errors.map((e) => '- ' + e).join('\n')}`); process.exit(1); }
  const now = (r.text.match(/## Now[\s\S]*?(?=\n## Map)/) || [''])[0];
  say(`${now.trim()}\n`);
  say(`ok: ${r.entries} entries, 0 original lines lost, validator passed${APPLY ? '' : ' (dry run: nothing was changed; add --apply to write)'}`);
  if (!APPLY) return;
  const brain = load().brain_dir || path.dirname(path.dirname(path.resolve(file)));
  const dir = path.join(brain, '.convert-backup');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const bak = path.join(dir, `${path.basename(file, '.md')}.${stamp}.md`);
  fs.copyFileSync(file, bak);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, r.text);
  fs.renameSync(tmp, file);
  say(`written: ${file}\nbackup of the old note: ${bak}\nundo: copy the backup over the note`);
}

main();
