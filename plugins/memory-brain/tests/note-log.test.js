#!/usr/bin/env node
// Tests for the Log engine: node plugins/memory-brain/tests/note-log.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseLog, computeNow, withGenerated, addEntry, validateNote } = require('../scripts/lib/note-log');
const { projects, renderIndex, updateIndexBlock, BEGIN, END } = require('../scripts/lib/note-index');
const { parse } = require('../scripts/lib/note-format');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).split('\n').join('\n     ') : '')); }
}
const FAKE_GH = 'gh' + 'p_' + 'Q7'.repeat(18); // assembled at run time so this file holds no real-looking secret

const FM = '---\nname: demo-project\ndescription: "Demo project."\nmetadata:\n  type: project\nfolders:\n  - D:/work/demo\n---\n';
const BASE = FM + '## Setup\n> How it is wired.\nsetup text\n\n## Archive\nold text\n## Not a section\nmore\n';
let clock = 0;
const at = () => new Date(2026, 9, 18, 10, clock++); // 2026-10-18 10:00, 10:01, ...
function add(text, tag, body, extra = {}) {
  const r = addEntry(text, { tag, text: body, date: at(), ...extra });
  if (!r.ok) throw new Error('add failed: ' + r.errors.join('; '));
  return r;
}

// 1 first entry creates Log, Now and Map in the right order; the note validates
let t = add(BASE, 'STATUS', 'Footage exists, not edited yet.').text;
{
  const keys = parse(t).sections.map((s) => s.key);
  check('order is now, map, log, setup, archive', keys.join(',') === 'now,map,log,setup,archive', keys.join(','));
  const v = validateNote(t);
  check('note with a Log validates', v.errors.length === 0, v.errors.join('\n'));
  check('Now shows the status', t.includes('**Status:** Footage exists, not edited yet.'));
}

// 2 the film incident replay: a FAILED entry shows in Now until it is closed
t = add(t, 'FAILED', 'B1 paid take crashed: credentials not attached, no form tab, 20 s timeout').text; // e2
t = add(t, 'TODO', 'Owner reviews the old footage').text; // e3
t = add(t, 'TODO', 'Edit the film in video-studio').text; // e4
{
  const now = computeNow(parseLog(t).entries).join('\n');
  check('open FAILED is in Now', /Failed or stuck\*\*\n- B1 paid take crashed/.test(now), now);
  check('TODOs numbered oldest first', /1\. Owner reviews the old footage \(e3\)\n2\. Edit the film/.test(now), now);
  check('index counts the failure', renderIndex(projects(writeTmp(t))).includes('1 FAILED'));
}
t = add(t, 'FIXED', 'Dry run now starts from a prebuilt canvas', { closes: ['e2'] }).text; // e5
{
  const now = computeNow(parseLog(t).entries).join('\n');
  check('closed FAILED leaves Failed or stuck', /Failed or stuck\*\*\n- none/.test(now), now);
  check('FIXED shows under Done', now.includes('Dry run now starts from a prebuilt canvas'));
}

// 3 replaces: an old FACT disappears from Now, a new one shows
t = add(t, 'FACT', 'Price is $20 per month').text; // e6
t = add(t, 'FACT', 'Price is $15 per month flat', { replaces: ['e6'] }).text; // e7
{
  const now = computeNow(parseLog(t).entries).join('\n');
  check('replaced fact is hidden', !now.includes('$20') && now.includes('$15 per month flat'), now);
}

// 4 newest first, increasing ids, idempotent generation
{
  const ids = parseLog(t).entries.map((e) => e.n);
  check('ids go up and the page is newest first', ids.join(',') === '7,6,5,4,3,2,1', ids.join(','));
  check('withGenerated is idempotent', withGenerated(t) === t);
  check('whole note still validates', validateNote(t).errors.length === 0, validateNote(t).errors.join('\n'));
}

// 5 add refusals (text unchanged, clear reasons)
function refuses(name, args, expect) {
  const r = addEntry(t, { date: at(), ...args });
  check('refuses: ' + name, !r.ok && r.errors.join(' ').includes(expect) && r.text === t, JSON.stringify(r.errors));
}
refuses('secret shape', { tag: 'FACT', text: 'token is ' + FAKE_GH }, 'secret');
refuses('unknown tag', { tag: 'WHATEVER', text: 'x' }, 'unknown tag');
refuses('empty text', { tag: 'DONE', text: '  ' }, 'no text');
refuses('closes a missing entry', { tag: 'FIXED', text: 'x', closes: ['e99'] }, 'no such entry');
refuses('closes a DONE', { tag: 'FIXED', text: 'x', closes: ['e5'] }, 'only TODO or FAILED');
refuses('replaces a different tag', { tag: 'FACT', text: 'x', replaces: ['e1'] }, 'same tag');

// 6 warnings but accepted
{
  const d = addEntry(t, { tag: 'DECISION', text: 'Use grep search', date: at() });
  check('DECISION without a reason warns', d.ok && d.warnings.some((w) => w.includes('say why')), JSON.stringify(d.warnings));
  const ok = addEntry(t, { tag: 'DECISION', text: 'Use grep search because an index drifts', date: at() });
  check('DECISION with a reason has no warning', ok.ok && !ok.warnings.some((w) => w.includes('say why')), JSON.stringify(ok.warnings));
  const dup = addEntry(t, { tag: 'TODO', text: 'Owner reviews the old footage', date: at() });
  check('near-duplicate warns', dup.ok && dup.warnings.some((w) => w.includes('near-duplicate')), JSON.stringify(dup.warnings));
}

// 7 text safety: separators and newlines are flattened so an entry can never break the format
{
  const r = addEntry(t, { tag: 'NOTE', text: 'line one\nline two · with a dot', date: at() });
  check('newline and separator sanitised', r.ok && /line one line two - with a dot/.test(r.entry.line) && validateNote(r.text).errors.length === 0, r.entry && r.entry.line);
}

// 8 broken notes MUST fail validation (prove the checks can fail)
function mustFail(name, text, expect) {
  const e = validateNote(text).errors.join(' | ');
  check('fails: ' + name, e.includes(expect), 'errors were: ' + (e || '(none)'));
}
mustFail('hand-edited Now', t.replace('Footage exists, not edited yet.', 'All finished.').replace(/\n- e1 · .*Footage exists, not edited yet\./, '\n- e1 · ' + '2026-10-18 10:00 · STATUS · Footage exists, not edited yet.'), 'out of date');
mustFail('stale Now (entry changed, Now not regenerated)', t.replace('B1 paid take crashed', 'B1 take crashed'), 'out of date');
mustFail('bad tag in a line', t.replace('· TODO · Edit the film', '· TODOO · Edit the film'), 'unknown tag');
mustFail('impossible date', t.replace('2026-10-18 10:03', '2026-13-45 10:03'), 'invalid date');
mustFail('duplicate id', t.replace('- e4 ·', '- e3 ·'), 'duplicate id');
mustFail('closes a missing entry', t.replace('closes e2', 'closes e42'), 'does not exist');
mustFail('a line that is not an entry', t.replace('## Log\n', '## Log\nrandom text line\n'), 'is not an entry');

// 9 the Now block stays within 40 lines however many entries exist
{
  let big = BASE;
  for (let i = 0; i < 120; i++) big = add(big, ['TODO', 'FAILED', 'DONE', 'FACT', 'DECISION'][i % 5], `entry number ${i} ${'padding '.repeat(5)}`).text;
  const v = validateNote(big);
  check('120 entries: valid, Now within the limit', v.errors.length === 0 && v.nowLines <= 40, `nowLines=${v.nowLines} ${v.errors.join('; ')}`);
  check('long lists are capped with a "more" line', /…\(\d+ more in the Log\)/.test(big));
}

// 10 CRLF notes keep CRLF
{
  const crlf = t.replace(/\n/g, '\r\n');
  const r = addEntry(crlf, { tag: 'DONE', text: 'crlf entry', date: at() });
  check('CRLF kept after add', r.ok && /\r\n/.test(r.text) && !/[^\r]\n/.test(r.text) && validateNote(r.text).errors.length === 0);
}

// 11 index: ranked for the folder, budgeted, markers idempotent, notes without a Log ignored
function writeTmp(noteText, name = 'demo.md') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-log-'));
  fs.writeFileSync(path.join(dir, name), noteText);
  return dir;
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-index-'));
  const mk = (name, folders, date, status) => {
    const base = `---\nname: ${name}\ndescription: "${name}."\nmetadata:\n  type: project\n${folders ? 'folders: ' + folders + '\n' : ''}---\n## Setup\n> s\nx\n`;
    return addEntry(base, { tag: 'STATUS', text: status, date }).text;
  };
  fs.writeFileSync(path.join(dir, 'a.md'), mk('alpha', 'D:/work/alpha', new Date(2026, 9, 1), 'alpha status'));
  fs.writeFileSync(path.join(dir, 'b.md'), mk('beta', 'D:/work/beta, D:/other/beta', new Date(2026, 9, 17), 'beta status'));
  fs.writeFileSync(path.join(dir, 'c.md'), mk('gamma', '', new Date(2026, 9, 10), 'gamma status'));
  fs.writeFileSync(path.join(dir, 'old.md'), FM + '## Old style\ntext\n');
  const list = projects(dir);
  check('index lists only notes with a Log', list.map((p) => p.name).sort().join(',') === 'alpha,beta,gamma', list.map((p) => p.name).join(','));
  const plain = renderIndex(list).split('\n').filter((l) => l.startsWith('- ')).map((l) => /\[(\w+)\]/.exec(l)[1]);
  check('no folder: newest first', plain.join(',') === 'beta,gamma,alpha', plain.join(','));
  const here = renderIndex(list, { cwd: 'D:\\Work\\Alpha\\src' }).split('\n').filter((l) => l.startsWith('- '));
  check('folder match goes first and is marked', /^- \* \[alpha\]/.test(here[0]) && here.length === 3, here.join('\n'));
  const budget = renderIndex(list, { maxLines: 2 }).split('\n').filter((l) => l.startsWith('- '));
  check('budget cuts with a "more" line', budget.length === 3 && /1 more projects/.test(budget[2]), budget.join('\n'));
  const memory = '# Index\n- [hand written](x.md) - keep me\n';
  const a = updateIndexBlock(memory, renderIndex(list));
  const b = updateIndexBlock(a, renderIndex(list));
  check('index block is added once and is idempotent', a === b && a.includes('keep me') && a.split(BEGIN).length === 2 && a.includes(END));
  const changed = updateIndexBlock(a, renderIndex(list, { maxLines: 1 }));
  check('index block is replaced, hand-written lines kept', changed.includes('keep me') && changed.split(BEGIN).length === 2 && /2 more projects/.test(changed));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 12 CLIs
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-cli-'));
  const file = path.join(dir, 'n.md');
  fs.writeFileSync(file, BASE);
  const bin = (f, ...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', f), ...a], { encoding: 'utf8' });
  let r = bin('note-add.js', file, 'STATUS', 'CLI status');
  check('note-add adds an entry', r.status === 0 && fs.readFileSync(file, 'utf8').includes('CLI status'), r.stdout + r.stderr);
  r = bin('note-add.js', file, 'FACT', 'key is ' + FAKE_GH);
  check('note-add refuses a secret', r.status === 1 && !fs.readFileSync(file, 'utf8').includes(FAKE_GH.slice(0, 8)), r.stdout);
  check('note-check passes on the CLI result', bin('note-check.js', dir).status === 0, bin('note-check.js', dir).stdout);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('CLI status', 'CLI status changed by hand'));
  check('note-check fails when the Log changed but Now did not', bin('note-check.js', dir).status === 1);
  check('note-gen reports it as stale', bin('note-gen.js', dir).status === 1);
  bin('note-gen.js', dir, '--write');
  check('note-gen --write repairs it', bin('note-gen.js', dir).status === 0 && bin('note-check.js', dir).status === 0, bin('note-check.js', dir).stdout);
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Index\n- keep\n');
  bin('note-gen.js', '--index', dir, '--write');
  const mem = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8');
  check('note-gen --index writes the block into MEMORY.md', mem.includes(BEGIN) && mem.includes('n') && mem.includes('- keep'), mem);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 12b hand edits are detected: the body fingerprint is stamped by addEntry and compared on read
{
  const { handEdited, bodyHash } = require('../scripts/lib/note-log');
  const n = add(BASE, 'STATUS', 'Stamp test status.').text;
  check('addEntry stamps the Now block', /<!-- body: [0-9a-f]{12} -->/.test(n) && handEdited(n).stamped === true);
  check('fresh note is not flagged', handEdited(n).edited === false);
  check('stamped note still validates', validateNote(n).errors.length === 0, validateNote(n).errors.join('\n'));
  check('note-gen keeps the stamp (idempotent)', withGenerated(n) === n);
  const edited = n.replace('setup text', 'setup text, changed by hand later');
  check('hand edit of a detail section is flagged', handEdited(edited).edited === true);
  const regen = validateNote(withGenerated(edited));
  check('validateNote warns about it but does not fail (after note-gen)', regen.errors.length === 0 && regen.warnings.some((w) => /edited by hand/.test(w)), JSON.stringify(regen));
  check('regenerating does NOT hide the hand edit', handEdited(withGenerated(edited)).edited === true);
  check('hand edit of the Archive is flagged too', handEdited(n.replace('old text', 'old text 2')).edited === true);
  check('changing only the generated Now is not a body edit', handEdited(n.replace('**Status:** Stamp test status.', '**Status:** changed in Now only')).edited === false);
  check('CRLF line endings or trailing blank lines are not an edit', handEdited(n.replace(/\n/g, '\r\n')).edited === false && bodyHash(n) === bodyHash(n + '\n\n'));
  const again = add(edited, 'DONE', 'Logged after the hand edit.').text;
  check('a new Log entry accepts the edit and clears the flag', handEdited(again).edited === false);
  const legacy = n.replace(/<!-- body: [0-9a-f]{12} -->\n/, '');
  check('a note with no stamp (older conversion) is never flagged', handEdited(legacy).edited === false && handEdited(legacy).stamped === false);
  check('a note without a Log is never flagged', handEdited(FM + 'plain text\n').edited === false);
  check('restamp adopts the current body', handEdited(withGenerated(edited, { restamp: true })).edited === false);
}

// 13 no personal paths in the new files
{
  const files = ['scripts/lib/note-log.js', 'scripts/lib/note-index.js', 'scripts/note-gen.js', 'scripts/note-add.js'];
  const bad = files.filter((f) => /[A-Z]:\\\\|\/Users\//i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  check('no personal paths or names in new scripts', bad.length === 0, bad.join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
