#!/usr/bin/env node
// Tests for the save reminder: node plugins/memory-brain/tests/save-reminder.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide } = require('../scripts/save-reminder');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'save-reminder-'));
const brain = path.join(work, 'brain');
fs.mkdirSync(brain, { recursive: true });

const prompt = (t) => ({ type: 'user', message: { role: 'user', content: t } });
const result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const use = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const edit = (f) => use('Edit', { file_path: f });
const edits = (n) => Array.from({ length: n }, (_, i) => [edit(path.join(work, `code${i}.js`)), result()]).flat();

check('3 edits and no log: remind', decide([prompt('go'), ...edits(3)], brain).remind === true);
check('2 edits: quiet', decide([prompt('go'), ...edits(2)], brain).remind === false);
check('memory_add in the reply: quiet', decide([prompt('go'), ...edits(4), use('mcp__plugin_memory-brain_memory-brain__memory_add', {}), result()], brain).remind === false);
check('a note written directly in the brain counts as logged: quiet', decide([prompt('go'), ...edits(4), edit(path.join(brain, 'projects', 'project_x.md')), result()], brain).remind === false);
check('edits of the brain itself do not count as work', decide([prompt('go'), edit(path.join(brain, 'a.md')), edit(path.join(brain, 'b.md')), edit(path.join(brain, 'c.md'))], brain).remind === false);
check('only the last reply counts', decide([prompt('one'), ...edits(5), prompt('two'), ...edits(1)], brain).remind === false);
check('tool results do not start a new reply', decide([prompt('go'), ...edits(2), result(), ...edits(2)], brain).remind === true);
check('Bash and Read are not edits', decide([prompt('go'), use('Bash', { command: 'x' }), use('Read', { file_path: 'a' }), use('Bash', {}), use('Bash', {})], brain).remind === false);
check('empty transcript is quiet', decide([], brain).remind === false);

// ---- the real script, end to end
const transcript = path.join(work, 't.jsonl');
const writeT = (lines) => fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const run = (ev) => spawnSync('node', [path.join(__dirname, '..', 'scripts', 'save-reminder.js')], {
  input: JSON.stringify(ev), encoding: 'utf8', timeout: 8000,
  env: { ...process.env, CLAUDE_PLUGIN_OPTION_BRAIN_DIR: brain, CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
});
writeT([prompt('go'), ...edits(3)]);
let r = run({ session_id: 'sr-test-1', transcript_path: transcript });
let out = {};
try { out = JSON.parse(r.stdout); } catch {}
check('script asks Claude to log (decision block)', out.decision === 'block' && /memory_add/.test(out.reason || ''), r.stdout + r.stderr);
check('script exits 0', r.status === 0);
r = run({ session_id: 'sr-test-1', transcript_path: transcript });
check('second call inside 30 minutes is quiet (cooldown)', r.stdout === '' && r.status === 0, r.stdout);
r = run({ session_id: 'sr-test-2', transcript_path: transcript, stop_hook_active: true });
check('stop_hook_active never loops', r.stdout === '' && r.status === 0, r.stdout);
r = run({ session_id: 'sr-test-3', transcript_path: path.join(work, 'missing.jsonl') });
check('missing transcript is quiet and exits 0', r.stdout === '' && r.status === 0);
r = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'save-reminder.js')], { input: 'not json', encoding: 'utf8', timeout: 8000 });
check('garbage input is quiet and exits 0', r.stdout === '' && r.status === 0);
for (const s of ['sr-test-1', 'sr-test-2', 'sr-test-3']) { try { fs.rmSync(path.join(os.tmpdir(), 'memory-brain-reminder-' + s)); } catch {} }

// ---- hook wiring and no personal paths
const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
const stopCmds = hooks.hooks.Stop.flatMap((g) => g.hooks.map((h) => (h.args || []).join(' ')));
check('hooks.json runs save-reminder on Stop', stopCmds.some((c) => /save-reminder\.js/.test(c)), stopCmds.join(' | '));
check('stop-log still runs on Stop', stopCmds.some((c) => /stop-log\.js/.test(c)));
check('no personal paths or names in save-reminder.js', !/[A-Z]:\\\\|\/Users\//i.test(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'save-reminder.js'), 'utf8')));

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
