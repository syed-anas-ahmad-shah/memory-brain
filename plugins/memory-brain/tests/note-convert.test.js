#!/usr/bin/env node
// Tests for the lossless converter: node plugins/memory-brain/tests/note-convert.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { convert, findLost } = require('../scripts/lib/note-convert');
const { validateNote, handEdited } = require('../scripts/lib/note-log');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).split('\n').join('\n     ') : '')); }
}
const FAKE_GH = 'gh' + 'p_' + 'Q7'.repeat(18);

const OLD = `---
name: harbor-bid
description: "The harbor dredging bid."
metadata:
  type: project
---
Intro line about the bid with a link [[other-note]].

## Setup
> How it is wired.
Crew of four, barge rented.

## Rules learned
Never bid under cost.
Always check the tide table.

## Now
An old heading that collides with the generated one.

## Archive
Old archive text stays.
`;
const SPEC = {
  aliases: ['harbor', 'dredging', 'bid'],
  folders: ['/work/harbor'],
  entries: [
    { k: 'a', d: '2026-03-01', t: '09:00', tag: 'FAILED', text: 'First bid was rejected: price above the cap' },
    { k: 'b', d: '2026-03-05', t: '10:00', tag: 'FIXED', text: 'Re-priced the bid under the cap', closes: ['a'] },
    { k: 'c', d: '2026-03-06', t: '11:00', tag: 'DECISION', text: 'Bid again because the cap was lifted' },
    { k: 'd', d: '2026-03-07', t: '12:00', tag: 'TODO', text: 'Send the signed form' },
    { k: 'e', d: '2026-03-08', t: '08:00', tag: 'STATUS', text: 'Bid submitted, waiting for the port office' },
  ],
};

// 1 the happy path
const r = convert(OLD, SPEC);
check('converts and validates', r.ok && r.errors.length === 0, r.errors.join('\n'));
check('no original line is lost', r.lost.length === 0, r.lost.join('\n'));
check('every original text line is still in the result', ['Crew of four, barge rented.', 'Never bid under cost.', 'Old archive text stays.', 'Intro line about the bid with a link [[other-note]].'].every((l) => r.text.includes(l)));
check('Now is computed from the Log (status + open TODO, closed FAILED hidden)', /\*\*Status:\*\* Bid submitted/.test(r.text) && /Send the signed form/.test(r.text) && !/First bid was rejected[^\n]*\(e1, /.test(r.text.split('## Map')[0].split('Failed or stuck')[1] || ''), r.text.slice(0, 900));
check('aliases and folders land in the frontmatter', /^aliases: harbor, dredging, bid$/m.test(r.text) && /^folders:\n  - \/work\/harbor$/m.test(r.text));
check('colliding headings were renamed, not dropped', /## Old Now/.test(r.text) && /## Old Archive/.test(r.text) && /An old heading that collides/.test(r.text));
check('the converted note passes the validator and is stamped', validateNote(r.text).errors.length === 0 && handEdited(r.text).stamped === true && handEdited(r.text).edited === false);
check('a second conversion is refused', convert(r.text, SPEC).ok === false && /already has a Log/.test(convert(r.text, SPEC).errors[0]));

// 2 CRLF input
const crlf = convert(OLD.replace(/\n/g, '\r\n'), SPEC);
check('CRLF input converts the same way', crlf.ok && crlf.lost.length === 0, crlf.errors.join('\n'));

// 3 bad input is refused with a clear reason and changes nothing
const bad = (spec, re, name) => { const x = convert(OLD, spec); check(name, x.ok === false && re.test(x.errors.join(' ')), JSON.stringify(x.errors)); };
bad({ entries: [] }, /at least one entry/, 'empty spec refused');
bad(null, /at least one entry/, 'missing spec refused');
bad({ entries: [{ d: '2026-03-01', tag: 'WHAT', text: 'x' }] }, /unknown tag/, 'unknown tag refused');
bad({ entries: [{ d: '2026-03-01', tag: 'FACT', text: 'the key is ' + FAKE_GH }] }, /secret/, 'a secret in an entry is refused');
bad({ entries: [{ k: 'a', d: '2026-03-01', tag: 'FIXED', text: 'x', closes: ['zzz'] }] }, /not an earlier entry key/, 'closes an unknown key refused');
bad({ entries: [{ k: 'a', d: '2026-13-45', tag: 'FACT', text: 'x' }] }, /bad date/, 'a bad date is refused');
check('a note without frontmatter is refused', convert('just text\n', SPEC).ok === false);

// 4 the loss detector can fail (planted)
check('findLost sees a deleted line', findLost('keep me\nlose me\n', 'keep me\n').join() === 'lose me');
check('findLost ignores blank lines and indentation', findLost('  a\n\n  b  \n', 'a\nb\n').length === 0);
const damaged = r.text.replace('Never bid under cost.\n', '');
check('a damaged result is reported as lost lines', findLost(OLD.split('---\n').slice(2).join('---\n'), damaged).length === 1);

// 5 the command line
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-convert-'));
const brain = path.join(dir, 'brain');
fs.mkdirSync(path.join(brain, 'projects'), { recursive: true });
fs.writeFileSync(path.join(brain, 'MEMORY.md'), '# Index\n');
const file = path.join(brain, 'projects', 'project_harbor.md');
fs.writeFileSync(file, OLD);
fs.writeFileSync(path.join(brain, 'projects', 'project_short.md'), '---\nname: short\ndescription: "Short."\nmetadata:\n  type: project\n---\nA tiny note.\n');
const specFile = path.join(dir, 'spec.json');
fs.writeFileSync(specFile, JSON.stringify(SPEC));
const env = { ...process.env, CLAUDE_PLUGIN_OPTION_BRAIN_DIR: brain, CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
const cli = (...a) => spawnSync('node', [path.join(__dirname, '..', 'scripts', 'note-convert.js'), ...a], { encoding: 'utf8', env, timeout: 15000 });
let o = cli('--list');
check('--list shows the older notes, biggest first', o.status === 0 && /0 layered, 2 older/.test(o.stdout) && o.stdout.indexOf('project_harbor') < o.stdout.indexOf('project_short'), o.stdout + o.stderr);
o = cli(file, specFile);
check('dry run shows the Now block and changes nothing', o.status === 0 && /dry run/.test(o.stdout) && /Bid submitted/.test(o.stdout) && fs.readFileSync(file, 'utf8') === OLD, o.stdout + o.stderr);
o = cli(file, specFile, '--apply');
check('--apply writes the layered note', o.status === 0 && /## Log/.test(fs.readFileSync(file, 'utf8')) && /backup of the old note/.test(o.stdout), o.stdout + o.stderr);
const baks = fs.existsSync(path.join(brain, '.convert-backup')) ? fs.readdirSync(path.join(brain, '.convert-backup')) : [];
check('the old note is backed up byte for byte', baks.length === 1 && fs.readFileSync(path.join(brain, '.convert-backup', baks[0]), 'utf8') === OLD);
o = cli(file, specFile, '--apply');
check('converting again is refused and the file is untouched', o.status === 1 && /already has a Log/.test(o.stdout), o.stdout);
o = cli('--list');
check('--list now shows 1 layered', /1 layered, 1 older/.test(o.stdout), o.stdout);
fs.writeFileSync(specFile, '{not json');
o = cli(path.join(brain, 'projects', 'project_short.md'), specFile);
check('a broken spec file is reported, not a crash', o.status === 1 && /cannot read the spec/.test(o.stdout), o.stdout + o.stderr);
fs.rmSync(dir, { recursive: true, force: true });

// 6 no personal paths
{
  const files = ['scripts/lib/note-convert.js', 'scripts/note-convert.js'];
  const badFiles = files.filter((f) => /[A-Z]:\\\\|\/Users\//i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  check('no personal paths or names in the converter', badFiles.length === 0, badFiles.join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
