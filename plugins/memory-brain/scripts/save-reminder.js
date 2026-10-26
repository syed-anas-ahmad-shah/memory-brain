#!/usr/bin/env node
// Memory Brain: Stop hook. Counts the real work done in this chat since the last memory_add
// (file edits and shell commands: deploys, tests, builds) and, when 4+ actions are unsaved,
// asks Claude once to log it (memory_add). Quiet by design: fires at most once per 10 minutes
// per chat, never loops (stop_hook_active), never blocks on an error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_WORK = 4;
const COOLDOWN_MS = 10 * 60 * 1000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// Pure decision, exported for tests. `lines` = parsed transcript entries, `brain` = memory folder.
// Work counts from the whole chat, not one reply, so saves batched over many replies are caught.
// A memory_add, or a note written directly in the brain, resets the count.
function decide(lines, brain) {
  const b = norm(brain);
  let work = 0;
  let edits = 0;
  let logged = false;
  for (const e of lines) {
    const c = e && e.message && e.message.content;
    if (!e || e.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const t of c) {
      if (!t || t.type !== 'tool_use') continue;
      if (/memory_add$/.test(t.name || '')) { work = 0; edits = 0; logged = true; continue; }
      const isEdit = EDIT_TOOLS.has(t.name);
      if (!isEdit && !COMMAND_TOOLS.has(t.name)) continue;
      if (isEdit) {
        const f = norm(t.input && (t.input.file_path || t.input.notebook_path));
        if (b && f.startsWith(b)) { work = 0; edits = 0; logged = true; continue; }
        edits++;
      }
      work++;
    }
  }
  return { remind: work >= MIN_WORK, work, edits, logged };
}

module.exports = { decide, MIN_WORK, COOLDOWN_MS };

if (require.main === module) {
  let input = '';
  const finish = () => {
    try {
      const ev = JSON.parse(input);
      if (ev.stop_hook_active || !ev.transcript_path) return process.exit(0);
      const { load } = require('./lib/config');
      const cfg = load();
      if (!cfg.brain_dir) return process.exit(0);
      const lines = fs.readFileSync(ev.transcript_path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const r = decide(lines, cfg.brain_dir);
      if (!r.remind) return process.exit(0);
      const stamp = path.join(os.tmpdir(), `memory-brain-reminder-${String(ev.session_id || 'x').replace(/[^\w-]/g, '')}`);
      let last = 0;
      try { last = Number(fs.readFileSync(stamp, 'utf8')) || 0; } catch {}
      if (Date.now() - last < COOLDOWN_MS) return process.exit(0);
      fs.writeFileSync(stamp, String(Date.now()));
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `Memory reminder: this chat has ${r.work} actions (${r.edits} file edits, the rest commands such as deploys or tests) since the last memory_add. If a step finished, a decision was made or something failed, call memory_add now (one short entry, with the reason for a DECISION). If nothing is worth saving, just say "nothing to log" in a few words.`,
      }));
    } catch {}
    process.exit(0);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, 3000).unref();
}
