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

const cmds = (n) => Array.from({ length: n }, () => [use('Bash', { command: 'npm test' }), result()]).flat();
const logCall = () => use('mcp__plugin_memory-brain_memory-brain__memory_add', {});

check('4 edits and no log: remind', decide([prompt('go'), ...edits(4)], brain).remind === true);
check('3 edits: quiet', decide([prompt('go'), ...edits(3)], brain).remind === false);
check('commands count as work (deploys, tests): 4 Bash remind', decide([prompt('go'), ...cmds(4)], brain).remind === true);
check('PowerShell counts as work', decide([prompt('go'), ...Array.from({ length: 4 }, () => use('PowerShell', { command: 'x' }))], brain).remind === true);
check('edits and commands add up', decide([prompt('go'), ...edits(2), ...cmds(2)], brain).remind === true);
check('Read and search are not work', decide([prompt('go'), ...Array.from({ length: 6 }, () => use('Read', { file_path: 'a' })), use('Grep', {}), use('Glob', {})], brain).remind === false);
check('memory_add after the work: quiet', decide([prompt('go'), ...edits(5), logCall(), result()], brain).remind === false);
check('a note written directly in the brain counts as logged: quiet', decide([prompt('go'), ...edits(5), edit(path.join(brain, 'projects', 'project_x.md')), result()], brain).remind === false);
check('edits of the brain itself do not count as work', decide([prompt('go'), ...Array.from({ length: 5 }, (_, i) => edit(path.join(brain, `n${i}.md`)))], brain).remind === false);
check('work counts across replies since the last save', decide([prompt('one'), ...cmds(2), prompt('two'), ...edits(2)], brain).remind === true);
check('only work after the last memory_add counts', decide([prompt('one'), ...edits(5), logCall(), prompt('two'), ...cmds(2)], brain).remind === false);
check('work after the last memory_add can remind again', decide([prompt('one'), logCall(), prompt('two'), ...edits(4)], brain).remind === true);
check('counts are reported', (() => { const r = decide([prompt('go'), ...edits(2), ...cmds(3)], brain); return r.work === 5 && r.edits === 2; })());
check('empty transcript is quiet', decide([], brain).remind === false);

// ---- the real script, end to end
const transcript = path.join(work, 't.jsonl');
const writeT = (lines) => fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const run = (ev) => spawnSync('node', [path.join(__dirname, '..', 'scripts', 'save-reminder.js')], {
  input: JSON.stringify(ev), encoding: 'utf8', timeout: 8000,
  env: { ...process.env, CLAUDE_PLUGIN_OPTION_BRAIN_DIR: brain, CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
});
writeT([prompt('go'), ...edits(2), ...cmds(2)]);
let r = run({ session_id: 'sr-test-1', transcript_path: transcript });
let out = {};
try { out = JSON.parse(r.stdout); } catch {}
check('script asks Claude to log (decision block)', out.decision === 'block' && /memory_add/.test(out.reason || ''), r.stdout + r.stderr);
check('script exits 0', r.status === 0);
r = run({ session_id: 'sr-test-1', transcript_path: transcript });
check('second call inside 10 minutes is quiet (cooldown)', r.stdout === '' && r.status === 0, r.stdout);
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
