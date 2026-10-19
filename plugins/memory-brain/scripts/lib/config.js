// Shared settings + paths for every memory-brain script. Nothing personal is hard-coded here.
// Settings come from the plugin's userConfig, in this order:
//   1. CLAUDE_PLUGIN_OPTION_<KEY> env vars (Claude Code exports these to hook processes)
//   2. pluginConfigs["memory-brain@<market>"].options in <claude dir>/settings.json (manual runs)
//   3. the defaults below
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN = 'memory-brain';
const DEFAULTS = { brain_dir: '', backup_remote: '', stale_days: 30, gh_account: '', commit_name: '', commit_email: '' };

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function savedOptions() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(claudeDir(), 'settings.json'), 'utf8'));
    const pc = s.pluginConfigs || {};
    const id = Object.keys(pc).find((k) => k === PLUGIN || k.startsWith(PLUGIN + '@'));
    return (id && pc[id] && pc[id].options) || {};
  } catch {
    return {};
  }
}

function load() {
  const saved = savedOptions();
  const cfg = {};
  for (const key of Object.keys(DEFAULTS)) {
    const env = process.env['CLAUDE_PLUGIN_OPTION_' + key.toUpperCase()];
    let v = env !== undefined && env !== '' ? env : saved[key];
    if (v === undefined || v === null || v === '') v = DEFAULTS[key];
    cfg[key] = typeof DEFAULTS[key] === 'number' ? Number(v) || DEFAULTS[key] : String(v).trim();
  }
  cfg.brain_dir = cfg.brain_dir ? path.resolve(cfg.brain_dir) : '';
  cfg.repo = cfg.brain_dir ? repoRoot(cfg.brain_dir) : '';
  cfg.state = stateDir();
  return cfg;
}

// The git repo that holds the brain (the brain folder may be a subfolder of it), else the brain folder itself.
function repoRoot(dir) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top ? path.resolve(top) : dir;
  } catch {
    return dir;
  }
}

// Machine-local state (last background run, lock). Survives plugin updates; never backed up.
function stateDir() {
  const d = process.env.CLAUDE_PLUGIN_DATA || path.join(claudeDir(), 'memory-brain-state');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Not notes. STATE.md is a retired hand-kept page (before 0.3.0); a leftover copy is ignored, never counted or checked.
const INDEX_FILES = new Set(['MEMORY.md', 'STATE.md', 'CATALOG.md']);

// Note folders = direct subfolders of the brain; notes = files directly inside them (not deeper:
// archive/full keeps originals under the same names on purpose). Notes at the brain root count as live.
// Skipped: dot-folders and log/ (the diary log lives there when the brain folder is the repo itself).
function noteFiles(brain) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(brain, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(brain, e.name);
    if (e.isFile() && e.name.endsWith('.md') && !INDEX_FILES.has(e.name)) out.push(info(full, '', e.name));
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'log') continue;
    for (const f of fs.readdirSync(full, { withFileTypes: true })) {
      if (f.isFile()) out.push(info(path.join(full, f.name), e.name, f.name));
    }
  }
  return out;
}

function info(full, dir, name) {
  const st = fs.statSync(full);
  return { full, dir, name, size: st.size, mtime: st.mtimeMs, live: dir !== 'archive' };
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

module.exports = { PLUGIN, load, claudeDir, repoRoot, noteFiles, git, INDEX_FILES };
