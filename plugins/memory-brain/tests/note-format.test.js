#!/usr/bin/env node
// Tests for the layered note format: node plugins/memory-brain/tests/note-format.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse, withMap, validate, lastVerified, NOW_MAX_LINES } = require('../scripts/lib/note-format');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).split('\n').join('\n     ') : '')); }
}

const FM = '---\nname: demo-note\ndescription: "Demo project. Status: halfway."\nmetadata:\n  type: project\n---\n';
const NOW = [
  '## Now',
  '**Status:** Halfway; the build works, the launch is not done.',
  '**Last verified:** 2026-10-18 18:13 (from the logs)',
  '**Done**',
  '- built the thing',
  '**Remaining** (in order)',
  '1. test it',
  '**Failed or stuck**',
  '- none',
].join('\n');
const SETUP = '## Setup\n> How it is wired.\nline a\nline b';
const ARCHIVE = '## Archive\nold text\n## Not a real section\nmore old text';
const good = () => withMap(FM + NOW + '\n\n' + SETUP + '\n\n' + ARCHIVE + '\n');

// 1 a correct note passes
let r = validate(good());
check('good note has no errors', r.errors.length === 0, r.errors.join('\n'));
check('good note has no warnings', r.warnings.length === 0, r.warnings.join('\n'));

// 2 the map is accurate: each listed range starts on that section's heading
{
  const t = good();
  const lines = t.split('\n');
  const rows = [...t.matchAll(/^\| (.+?) \| (\d+)-(\d+) \| \d+ \| .* \|$/gm)].filter((m) => m[1] !== 'Section');
  check('map lists Now, Setup, Archive', rows.map((m) => m[1]).join(',') === 'Now,Setup,Archive', rows.map((m) => m[1]).join(','));
  check('map line ranges point at the headings', rows.every((m) => lines[+m[2] - 1] === '## ' + m[1]), rows.map((m) => m[1] + '@' + m[2]).join(' '));
}

// 3 idempotent and safe on repeated runs
check('withMap is idempotent', withMap(good()) === good());

// 4 headings inside code fences are ignored; archive inner headings are ignored
{
  const t = withMap(FM + NOW + '\n\n## Setup\n> x\n```\n## fake heading\n```\n\n' + ARCHIVE + '\n');
  check('fenced heading not a section', !parse(t).sections.some((s) => s.title === 'fake heading'));
  check('archive inner heading not a section', !parse(t).sections.some((s) => s.title === 'Not a real section'));
  check('fenced/archive note still valid', validate(t).errors.length === 0, validate(t).errors.join('\n'));
}

// 5 each broken note must FAIL (prove the checks can fail)
function mustFail(name, text, expect) {
  const e = validate(text).errors.join(' | ');
  check('fails: ' + name, e.includes(expect), 'errors were: ' + (e || '(none)'));
}
mustFail('no frontmatter', good().replace(FM, ''), 'missing frontmatter');
mustFail('no description', good().replace(/description: .*\n/, ''), 'description');
mustFail('Now not first', withMap(FM + SETUP + '\n\n' + NOW + '\n'.repeat(1)).replace(/## Now/, '## Later'), 'first "##" section');
mustFail('missing Done field', good().replace('**Done**\n- built the thing\n', ''), '"**Done**"');
mustFail('missing Failed or stuck', good().replace(/\*\*Failed or stuck\*\*\n- none/, ''), 'Failed or stuck');
mustFail('no date', good().replace('2026-10-18 18:13', 'yesterday'), 'needs a date');
mustFail('Now too long', withMap(FM + NOW + '\n' + Array(NOW_MAX_LINES).fill('- extra').join('\n') + '\n\n' + SETUP + '\n'), 'Now block is');
mustFail('stale map', good().replace('line a', 'line a\nnew line added without rebuilding the map'), 'Map is out of date');
mustFail('hand-edited map', good().replace(/\| Setup \| (\d+)-(\d+)/, '| Setup | 1-2'), 'Map is out of date');
mustFail('map missing', FM + NOW + '\n\n' + SETUP + '\n', 'second section must be "## Map"');
mustFail('duplicate section', withMap(FM + NOW + '\n\n' + SETUP + '\n\n' + SETUP + '\n'), 'duplicate');

// 6 warnings (not errors) for a missing one-line summary
{
  const t = withMap(FM + NOW + '\n\n## Notes\nno summary line here\n');
  const v = validate(t);
  check('missing summary is only a warning', v.errors.length === 0 && v.warnings.some((w) => w.includes('Notes')), JSON.stringify(v));
}

// 7 CRLF notes work and stay CRLF
{
  const crlf = good().replace(/\n/g, '\r\n');
  check('CRLF note validates', validate(crlf).errors.length === 0, validate(crlf).errors.join('\n'));
  check('CRLF kept by withMap', withMap(crlf).includes('\r\n') && !/[^\r]\n/.test(withMap(crlf)));
}

// 8 lastVerified reads the date and time
{
  const d = lastVerified(good());
  check('lastVerified parsed', d && d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 18 && d.getHours() === 18 && d.getMinutes() === 13, String(d));
}

// 9 CLI: check passes on a folder with one good, one older note; --strict fails on the older one; map --write fixes a stale map
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-format-'));
  fs.writeFileSync(path.join(dir, 'a.md'), good());
  fs.writeFileSync(path.join(dir, 'old.md'), FM + '## Old style\ntext\n');
  const bin = (f, ...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', f), ...a], { encoding: 'utf8' });
  check('note-check passes (older note not failed)', bin('note-check.js', dir).status === 0, bin('note-check.js', dir).stdout);
  check('note-check --strict fails on older note', bin('note-check.js', dir, '--strict').status === 1);
  fs.writeFileSync(path.join(dir, 'a.md'), good().replace('line a', 'line a\nextra'));
  check('note-check fails on stale map', bin('note-check.js', dir).status === 1);
  bin('note-map.js', dir, '--write');
  check('note-map --write repairs the map', bin('note-check.js', dir).status === 0, bin('note-check.js', dir).stdout);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 10 no personal paths in the new files
{
  const files = ['scripts/lib/note-format.js', 'scripts/lib/note-files.js', 'scripts/note-map.js', 'scripts/note-check.js'];
  const bad = files.filter((f) => /[A-Z]:\\\\|\/Users\//i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  check('no personal paths or names in new scripts', bad.length === 0, bad.join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
