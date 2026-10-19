// Notes saved OUTSIDE the brain: chats started before the switch keep writing to Claude's default
// per-project memory folders (<claude dir>/projects/*/memory/). The plugin does not copy them over
// (that could overwrite hand-edited notes), so the badge warns instead.
// A note counts as stray when it changed after the plugin first ran here (a start time recorded once in the
// state folder) AND the brain has no same-named copy that is at least as new.
'use strict';
const fs = require('fs');
const path = require('path');
const { claudeDir, noteFiles, INDEX_FILES } = require('./config');

function since(state) {
  const f = path.join(state, 'stray-since.txt');
  try { return Number(fs.readFileSync(f, 'utf8').trim()) || 0; } catch {}
  const now = Date.now();
  try { fs.writeFileSync(f, String(now)); } catch {}
  return now;
}

function strayNotes(cfg) {
  const start = since(cfg.state);
  const brainCopies = new Map(noteFiles(cfg.brain_dir).map((n) => [n.name, n.mtime]));
  const brain = path.resolve(cfg.brain_dir).toLowerCase();
  const projects = path.join(claudeDir(), 'projects');
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projects); } catch { return out; }
  for (const d of dirs) {
    const mem = path.join(projects, d, 'memory');
    if (path.resolve(mem).toLowerCase() === brain) continue;
    let files = [];
    try { files = fs.readdirSync(mem, { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.md') || INDEX_FILES.has(f.name)) continue;
      const full = path.join(mem, f.name);
      const mtime = fs.statSync(full).mtimeMs;
      if (mtime <= start) continue;
      const copy = brainCopies.get(f.name);
      if (copy !== undefined && copy >= mtime) continue;
      out.push({ name: f.name, full, mtime });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

module.exports = { strayNotes };
