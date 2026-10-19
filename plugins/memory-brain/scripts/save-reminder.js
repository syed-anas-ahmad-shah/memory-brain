#!/usr/bin/env node
// Memory Brain: Stop hook. After a reply that edited several files but logged nothing to memory,
// asks Claude once to log it (memory_add). Quiet by design: needs 3+ edits in the reply,
// fires at most once per 30 minutes per chat, never loops (stop_hook_active), never blocks on an error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_EDITS = 3;
const COOLDOWN_MS = 30 * 60 * 1000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// Pure decision, exported for tests. `lines` = parsed transcript entries, `brain` = memory folder.
function decide(lines, brain) {
  let start = 0;
  lines.forEach((e, i) => {
    const c = e && e.message && e.message.content;
    const isUser = e && e.type === 'user' && e.message && e.message.role === 'user';
    const realPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x && x.type === 'text'));
    if (isUser && realPrompt) start = i + 1;
  });
  const b = norm(brain);
  let edits = 0;
  let logged = false;
  for (const e of lines.slice(start)) {
    const c = e && e.message && e.message.content;
    if (!e || e.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const t of c) {
      if (!t || t.type !== 'tool_use') continue;
      if (/memory_add$/.test(t.name || '')) { logged = true; continue; }
      if (!EDIT_TOOLS.has(t.name)) continue;
      const f = norm(t.input && (t.input.file_path || t.input.notebook_path));
      if (b && f.startsWith(b)) logged = true; else edits++;
    }
  }
  return { remind: edits >= MIN_EDITS && !logged, edits, logged };
}

module.exports = { decide, MIN_EDITS, COOLDOWN_MS };

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
        reason: `Memory reminder: this reply changed ${r.edits} files but logged nothing. If a task finished, a decision was made or something failed, call memory_add now (one short entry, with the reason for a DECISION). If nothing is worth saving, just say "nothing to log" in a few words.`,
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
