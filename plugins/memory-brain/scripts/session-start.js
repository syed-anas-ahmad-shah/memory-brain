#!/usr/bin/env node
// Memory Brain: SessionStart hook (well under a second). Builds the visible memory badge from REAL state,
// hands it to Claude to show on the first reply of the chat, then starts the slow backup in the background.
// Never throws, never blocks: any internal error still produces a badge that says something is wrong.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { load, noteFiles } = require('./lib/config');
const { strayNotes } = require('./lib/stray');

const ICON = '\u{1F9E0}';
const DOT = '·';
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function ago(ms) {
  const mins = Math.max(0, Math.round(ms / 60e3));
  if (mins < 90) return `${mins} min ago`;
  if (mins < 2880) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function lastRun(state, problems) {
  const file = path.join(state, 'last-run.txt');
  let line = '';
  try { line = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim(); } catch {}
  if (!line) return 'backup not run yet';
  const when = line.split('|')[0].trim();
  let backup;
  if (/backup ok \w+/.test(line)) backup = `backup ok (${when})`;
  else if (/nothing new/.test(line)) backup = `backup up to date (${when})`;
  else if (/local only/.test(line)) backup = `backup local only (${when})`;
  else { problems.push(`backup problem at ${when}`); backup = 'backup FAILED'; }
  if (fs.statSync(file).mtimeMs < Date.now() - 48 * HOUR) problems.push('no backup for 48h+');
  return backup;
}

function isProject(n) {
  try { return /^\s*type:\s*project\b/m.test(fs.readFileSync(n.full, 'utf8').slice(0, 600)); } catch { return false; }
}

function badge(cfg) {
  const problems = [];
  if (!cfg.brain_dir) return [`not set up: no memory folder chosen`, 'run /memory-brain:setup'];
  if (!fs.existsSync(path.join(cfg.brain_dir, 'MEMORY.md'))) return [`not set up: no MEMORY.md in ${cfg.brain_dir}`, 'run /memory-brain:setup'];

  const backup = lastRun(cfg.state, problems);
  const live = noteFiles(cfg.brain_dir).filter((n) => n.live);
  const times = live.map((n) => n.mtime);
  const saved = times.length ? 'saved ' + ago(Date.now() - Math.max(...times)) : 'nothing saved yet';

  // stale = project notes not edited for stale_days (a projects/ folder if there is one, else type: project)
  const hasProjectsDir = live.some((n) => n.dir === 'projects');
  const cutoff = Date.now() - cfg.stale_days * DAY;
  const stale = live.filter((n) => (hasProjectsDir ? n.dir === 'projects' : isProject(n)) && n.mtime < cutoff).length;

  const stray = strayNotes(cfg);
  if (stray.length) problems.push(`${stray.length} note${stray.length === 1 ? '' : 's'} saved outside the brain (old memory folder): ${stray[0].name}`);

  const parts = [saved, backup, `${live.length} live note${live.length === 1 ? '' : 's'}`];
  if (stale > 0) parts.push(`${stale} stale`);
  if (problems.length) return problems.concat(parts, ['tell the owner']);
  return { ok: parts };
}

let line;
let cfg = null;
try {
  cfg = load();
  const b = badge(cfg);
  line = Array.isArray(b) ? `${ICON} Memory ! ${DOT} ${b.join(` ${DOT} `)}` : `${ICON} Memory OK ${DOT} ${b.ok.join(` ${DOT} `)}`;
} catch (e) {
  line = `${ICON} Memory ! ${DOT} badge check crashed: ${String(e && e.message).slice(0, 120)} ${DOT} tell the owner`;
}

const text = 'REQUIRED memory badge (memory plugin, built from real files): your FIRST reply in this chat, whatever the message is ' +
  '(even a greeting), must contain this exact line as text before any tool call, on its own line right after any other badge line. ' +
  `Show it once, in the first reply only. Do not change its facts. If it starts with '${ICON} Memory !', also say in one plain sentence what is wrong.\n` + line;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));

// Background backup: detached, hidden, outlives this hook. Skipped when not set up or when told not to (tests).
try {
  if (cfg && cfg.brain_dir && process.env.MEMORY_BRAIN_NO_BACKGROUND !== '1') {
    spawn(process.execPath, [path.join(__dirname, 'maintenance.js')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
  }
} catch {}
process.exit(0);
