#!/usr/bin/env node
// Memory Brain: setup worker behind /memory-brain:setup. The skill asks the user first; this script only does
// what the flags say. Every settings.json / CLAUDE.md write is backed up first and recorded for `undo`.
//   node setup.js plan  [--brain DIR]                       -> JSON facts, changes nothing
//   node setup.js apply --brain DIR [--import DIR]... [--remote URL|NAME] [--auto-memory] [--claude-md]
//                       [--use-parent-repo] [--stale-days N] [--gh-account X] [--commit-name X] [--commit-email X]
//                       [--first-backup]
//   node setup.js undo                                       -> puts settings + CLAUDE.md back, keeps the notes
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PLUGIN, claudeDir, noteFiles, INDEX_FILES } = require('./lib/config');

const MARK_START = '<!-- memory-brain:start -->';
const MARK_END = '<!-- memory-brain:end -->';
const FOLDERS = { feedback: 'feedback', project: 'projects', reference: 'reference', user: 'reference' };
const fwd = (p) => p.replace(/\\/g, '/');
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

// ---------- args
function parseArgs(argv) {
  const a = { _: [], import: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { a._.push(k); continue; }
    const key = k.slice(2);
    const flag = ['auto-memory', 'claude-md', 'use-parent-repo', 'first-backup'].includes(key);
    const v = flag ? true : argv[++i];
    if (key === 'import') a.import.push(v); else a[key] = v;
  }
  return a;
}

// ---------- small helpers
function tryGit(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
function has(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const settingsPath = () => path.join(claudeDir(), 'settings.json');
const claudeMdPath = () => path.join(claudeDir(), 'CLAUDE.md');
const undoPath = () => path.join(claudeDir(), 'memory-brain-state', 'setup-undo.json');

function readSettings() {
  const f = settingsPath();
  if (!fs.existsSync(f)) return { exists: false, valid: true, data: {}, indent: 2 };
  const text = fs.readFileSync(f, 'utf8');
  try {
    const m = text.match(/\n([ \t]+)"/);
    return { exists: true, valid: true, data: JSON.parse(text), indent: m ? m[1] : 2 };
  } catch (e) {
    return { exists: true, valid: false, error: e.message };
  }
}
function pluginId(s) {
  const pick = (o) => Object.keys(o || {}).find((k) => k.startsWith(PLUGIN + '@'));
  return pick(s.enabledPlugins) || pick(s.pluginConfigs) || `${PLUGIN}@${PLUGIN}-market`;
}

// where the brain sits relative to git: none / its own repo / inside another repo
function repoStatus(brain) {
  const probe = fs.existsSync(brain) ? brain : path.dirname(brain);
  const top = fs.existsSync(probe) ? tryGit(['rev-parse', '--show-toplevel'], probe) : null;
  if (!top) return { kind: 'none' };
  const remotes = (tryGit(['remote', '-v'], top) || '').split('\n').filter((l) => l.endsWith('(push)')).map((l) => l.split(/\s+/).slice(0, 2).join(' '));
  return { kind: path.resolve(top) === path.resolve(brain) ? 'own' : 'parent', top: path.resolve(top), remotes };
}

function memoryDirs(exclude) {
  const out = [];
  const projects = path.join(claudeDir(), 'projects');
  let names = [];
  try { names = fs.readdirSync(projects); } catch {}
  for (const n of names) {
    const d = path.join(projects, n, 'memory');
    if (!fs.existsSync(d) || (exclude && path.resolve(d) === path.resolve(exclude))) continue;
    const notes = fs.readdirSync(d).filter((f) => f.endsWith('.md') && !INDEX_FILES.has(f)).length;
    if (notes) out.push({ dir: d, notes });
  }
  return out;
}

// ---------- plan
function plan(args) {
  const s = readSettings();
  const data = s.valid ? s.data : {};
  const id = pluginId(data);
  const saved = ((data.pluginConfigs || {})[id] || {}).options || {};
  const auto = data.autoMemoryDirectory || '';
  const brain = path.resolve(args.brain || saved.brain_dir || auto || path.join(claudeDir(), 'memory-brain'));
  return {
    claude_dir: claudeDir(),
    settings: s.exists ? (s.valid ? 'valid' : `INVALID JSON (${s.error}) - setup will refuse until fixed`) : 'none yet',
    plugin_id: id,
    saved_options: saved,
    auto_memory_directory: auto || null,
    claude_md_rule_present: fs.existsSync(claudeMdPath()) && fs.readFileSync(claudeMdPath(), 'utf8').includes(MARK_START),
    suggested_brain: brain,
    brain_exists: fs.existsSync(brain),
    brain_has_memory_md: fs.existsSync(path.join(brain, 'MEMORY.md')),
    brain_notes: noteFiles(brain).length,
    git: has('git'),
    gh: has('gh'),
    repo: repoStatus(brain),
    import_candidates: memoryDirs(brain).concat(auto && path.resolve(auto) !== brain && fs.existsSync(auto) ? [{ dir: auto, notes: noteFiles(auto).length, note: 'current autoMemoryDirectory' }] : []),
    undo_available: fs.existsSync(undoPath()),
  };
}

// ---------- templates
const MEMORY_TEMPLATE = `# Memory index. Ask memory_index for what is happening, memory_search for anything else. Every note: CATALOG.md.
Rules: one project = one note with a Log; change it only with memory_add. Old or finished notes go to archive/. No secrets.

## Notes
`;
const GITIGNORE = `# secrets and machine-local files must never be backed up
*.env
.env*
*.pem
*.key
*.p12
*.pfx
id_rsa*
credentials*.json
*-credentials.json
*.bak
*.tmp
Thumbs.db
.DS_Store
node_modules/
`;
function claudeMdRule(brain) {
  return `${MARK_START}
# Memory saves (memory-brain plugin)

Your memory folder is \`${fwd(brain)}\`. Save to it yourself, without being asked:

- Before answering about past work, a decision or a project's status, call \`memory_search\`, then \`memory_read\`. Any question about the user's own projects, products, prices, accounts, tools, setup or past decisions ("what is our...", "which ... do we use", "how do I ...") is a memory question: search FIRST, even if you think you already know the answer. Only pure general-knowledge questions skip memory. For "what is happening" call \`memory_index\`. If the notes do not state the answer, say "not recorded". Do not guess. If \`memory_read\` shows a WARNING that the note was edited by hand, read the sections it lists.
- When something fails, a decision is made (with its reason) or a task finishes, call \`memory_add\` with a tag (DONE, DECISION, FAILED, TODO, FACT, RULE); use \`closes eN\` when it finishes an item. A note that has a \`## Log\` is changed ONLY with \`memory_add\`; never hand-edit its Now, Map or text.
- A new topic is a new note in \`feedback/\` (how to work), \`projects/\` (ongoing work) or \`reference/\` (facts, accounts, pointers), with frontmatter \`name\`, \`description\`, \`metadata.type\`. Old or finished notes move to \`archive/\`, never deleted.
- Never put real secrets (keys, tokens, passwords) in memory. Backups run automatically: do not \`git push\` the memory yourself.
${MARK_END}`;
}

// ---------- import
function frontmatter(text, key) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return '';
  const m = fm[1].match(new RegExp(`^\\s*${key}:\\s*"?(.*?)"?\\s*$`, 'm'));
  return m ? m[1].trim() : '';
}
function importNotes(brain, dirs, report) {
  const existing = new Set(noteFiles(brain).map((n) => n.name));
  const lines = [];
  for (const src of dirs) {
    const srcIndex = fs.existsSync(path.join(src, 'MEMORY.md')) ? fs.readFileSync(path.join(src, 'MEMORY.md'), 'utf8').split(/\r?\n/) : [];
    const files = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md') && !INDEX_FILES.has(e.name)).map((e) => e.name);
    for (const name of files) {
      if (existing.has(name)) { report.skipped.push(`${name} (a note with this name is already in the memory folder)`); continue; }
      const text = fs.readFileSync(path.join(src, name), 'utf8');
      const type = frontmatter(text, 'type').toLowerCase();
      const folder = FOLDERS[type] || 'reference';
      if (!FOLDERS[type]) report.unknownType.push(name);
      fs.mkdirSync(path.join(brain, folder), { recursive: true });
      fs.copyFileSync(path.join(src, name), path.join(brain, folder, name));
      existing.add(name);
      report.imported.push(`${folder}/${name}`);
      const old = srcIndex.find((l) => l.includes(`(${name})`) || l.includes(`(./${name})`));
      const title = (old && (old.match(/\[([^\]]+)\]/) || [])[1]) || frontmatter(text, 'name') || name.replace(/\.md$/, '');
      const hook = (old && old.split(')').slice(1).join(')').replace(/^\s*[-—:]\s*/, '').trim()) || frontmatter(text, 'description');
      lines.push(`- [${title}](${folder}/${name})${hook ? ' - ' + hook : ''}`);
    }
  }
  if (!lines.length) return;
  const idxFile = path.join(brain, 'MEMORY.md');
  const idx = fs.readFileSync(idxFile, 'utf8').replace(/\s*$/, '\n');
  fs.writeFileSync(idxFile, idx + '\n' + [`## Imported ${today()}`, ...lines].join('\n') + '\n');
  report.indexLines = lines.length;
}

// ---------- settings + CLAUDE.md
function backupFile(file, record, key) {
  if (!fs.existsSync(file)) return;
  const bak = `${file}.memory-brain-${stamp()}.bak`;
  fs.copyFileSync(file, bak);
  if (!record[key]) record[key] = bak;
  return bak;
}
function loadUndo() { try { return JSON.parse(fs.readFileSync(undoPath(), 'utf8')); } catch { return null; } }

// ---------- apply
function apply(args) {
  const out = [];
  const say = (l) => out.push(l);
  if (!args.brain) throw new Error('--brain DIR is required');
  const brain = path.resolve(args.brain);

  // prechecks: nothing is written if any of these fail
  const s = readSettings();
  if (!s.valid) throw new Error(`${settingsPath()} is not valid JSON (${s.error}). Nothing was changed. Fix that file, then run setup again.`);
  if (!has('git')) throw new Error('git is not installed. Nothing was changed. Install git, then run setup again.');
  const repo = repoStatus(brain);
  if (repo.kind === 'parent' && !args['use-parent-repo']) {
    throw new Error(`${brain} is inside another git repo (${repo.top}). Backups would commit EVERYTHING in that repo. Nothing was changed. Pick another folder, or re-run with --use-parent-repo if that repo is only for memory.`);
  }
  const imports = args.import.map((d) => path.resolve(d)).filter((d) => d !== brain);
  for (const d of imports) if (!fs.existsSync(d)) throw new Error(`import folder not found: ${d}. Nothing was changed.`);
  const remote = args.remote ? String(args.remote).trim() : '';
  const isPlace = remote && (/^[a-z][a-z0-9+.-]*:\/\/|^[^/\\\s]+@[^:\s]+:|[/\\]/i.test(remote) || fs.existsSync(remote));
  if (remote && !isPlace && !(repo.remotes || []).some((r) => r.startsWith(remote + ' '))) {
    throw new Error(`"${remote}" is neither a git address nor a remote of this memory repo. Nothing was changed.`);
  }

  // 1) folder + starter files (never overwrite)
  for (const f of ['feedback', 'projects', 'reference', 'archive']) fs.mkdirSync(path.join(brain, f), { recursive: true });
  const created = [];
  if (!fs.existsSync(path.join(brain, 'MEMORY.md'))) { fs.writeFileSync(path.join(brain, 'MEMORY.md'), MEMORY_TEMPLATE); created.push('MEMORY.md'); }
  say(created.length ? `created: ${created.join(', ')} in ${brain}` : `memory folder ready: ${brain} (existing files kept)`);

  // 2) import
  const report = { imported: [], skipped: [], unknownType: [], indexLines: 0 };
  if (imports.length) {
    importNotes(brain, imports, report);
    say(`imported ${report.imported.length} note(s); ${report.indexLines} added to MEMORY.md`);
    for (const k of report.skipped) say(`  skipped: ${k}`);
    if (report.unknownType.length) say(`  no known type, put in reference/: ${report.unknownType.join(', ')}`);
  }
  if (imports.length || !fs.existsSync(path.join(brain, 'CATALOG.md'))) require('./make-catalog').build(brain);

  // 3) git repo
  let top = repo.top;
  if (repo.kind === 'none') {
    execFileSync('git', ['init', '-q'], { cwd: brain });
    top = brain;
    say('git repo created in the memory folder');
  }
  if (!fs.existsSync(path.join(top, '.gitignore'))) { fs.writeFileSync(path.join(top, '.gitignore'), GITIGNORE); say('.gitignore added (keeps key and credential files out of backups)'); }
  let backupRemote = remote;
  if (remote && isPlace) {
    const origin = tryGit(['remote', 'get-url', 'origin'], top);
    if (!origin) { execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: top }); backupRemote = 'origin'; say(`backup address saved as git remote "origin": ${remote}`); }
    else if (origin === remote) backupRemote = 'origin';
    else say(`git remote "origin" already points elsewhere; backups will push straight to ${remote}`);
  }
  try { require('./install-git-hooks').install(top).forEach((l) => say(l)); } catch (e) { say(`warning: git hooks not installed (${e.message})`); }

  // 4) settings.json (backed up first) + undo record that keeps the ORIGINAL values across repeated runs
  const record = loadUndo() || { created: new Date().toISOString() };
  const data = s.data;
  const id = pluginId(data);
  if (!record.pluginId) record.pluginId = id;
  if (!record.previous) {
    record.previous = {
      autoMemoryDirectory: 'autoMemoryDirectory' in data ? { had: true, value: data.autoMemoryDirectory } : { had: false },
      pluginConfig: data.pluginConfigs && id in data.pluginConfigs ? { had: true, value: data.pluginConfigs[id] } : { had: false },
    };
  }
  backupFile(settingsPath(), record, 'settingsBackup');
  const options = { ...(((data.pluginConfigs || {})[id] || {}).options || {}), brain_dir: fwd(brain) };
  if (remote) options.backup_remote = backupRemote;
  if (args['stale-days']) options.stale_days = Number(args['stale-days']);
  for (const k of ['gh-account', 'commit-name', 'commit-email']) if (args[k] !== undefined) options[k.replace('-', '_')] = args[k];
  data.pluginConfigs = data.pluginConfigs || {};
  data.pluginConfigs[id] = { ...(data.pluginConfigs[id] || {}), options };
  if (args['auto-memory']) data.autoMemoryDirectory = fwd(brain);
  writeAtomic(settingsPath(), JSON.stringify(data, null, s.indent) + '\n');
  say(`plugin settings saved in ${settingsPath()}${record.settingsBackup ? ' (backup: ' + path.basename(record.settingsBackup) + ')' : ''}`);
  if (args['auto-memory']) say(`autoMemoryDirectory set to ${fwd(brain)}: new chats save memory there`);

  // 5) CLAUDE.md rule (marked block, replaced in place on a re-run)
  if (args['claude-md']) {
    const f = claudeMdPath();
    const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    backupFile(f, record, 'claudeMdBackup');
    const block = claudeMdRule(brain);
    const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`);
    const after = re.test(before) ? before.replace(re, () => block) : (before ? before.replace(/\s*$/, '\n\n') : '') + block + '\n';
    writeAtomic(f, after);
    record.claudeMd = true;
    say(`memory save rule ${re.test(before) ? 'updated' : 'added'} in ${f}`);
  }
  writeAtomic(undoPath(), JSON.stringify(record, null, 2) + '\n');

  // 6) first commit, health check, optional first backup
  const { load } = require('./lib/config');
  const cfg = load();
  cfg.brain_dir = brain; cfg.repo = top; cfg.backup_remote = backupRemote || cfg.backup_remote;
  if (args['first-backup'] && cfg.backup_remote) {
    try {
      const lines = [];
      const log = console.log; console.log = (l) => lines.push(l);
      try { require('./backup').run(cfg); } finally { console.log = log; }
      say(`first backup: ${lines[lines.length - 1]}`);
    } catch (e) { say(`FIRST BACKUP FAILED: ${e.message}`); }
  } else {
    execFileSync('git', ['add', '-A'], { cwd: top });
    if (tryGit(['status', '--porcelain'], top)) {
      const who = [];
      const name = options.commit_name || tryGit(['config', 'user.name'], top) || 'memory-brain';
      const email = options.commit_email || tryGit(['config', 'user.email'], top) || 'memory-brain@localhost';
      who.push('-c', `user.name=${name}`, '-c', `user.email=${email}`);
      try { execFileSync('git', [...who, 'commit', '-q', '-m', 'memory-brain setup'], { cwd: top, stdio: ['ignore', 'pipe', 'pipe'] }); say('first local commit done'); }
      catch (e) { say(`COMMIT BLOCKED: ${String(e.stdout || e.message).trim().split('\n').slice(0, 4).join(' | ')}`); }
    }
  }
  const failed = require('./memory-check').check(brain).filter((r) => !r.ok);
  say(failed.length ? `HEALTH CHECK: ${failed.map((r) => `${r.name} (${r.detail})`).join('; ')}` : 'health check: all passed');
  say('undo any time: node setup.js undo (puts settings and CLAUDE.md back; your notes stay)');
  return out;
}

// ---------- undo
function undo() {
  const record = loadUndo();
  if (!record) return ['nothing to undo: setup has not changed any settings on this machine'];
  const out = [];
  const s = readSettings();
  if (!s.valid) throw new Error(`${settingsPath()} is not valid JSON (${s.error}); nothing was changed`);
  if (s.exists) {
    const data = s.data;
    fs.copyFileSync(settingsPath(), `${settingsPath()}.memory-brain-undo-${stamp()}.bak`);
    const p = record.previous || {};
    if (p.autoMemoryDirectory && p.autoMemoryDirectory.had) data.autoMemoryDirectory = p.autoMemoryDirectory.value; else delete data.autoMemoryDirectory;
    data.pluginConfigs = data.pluginConfigs || {};
    if (p.pluginConfig && p.pluginConfig.had) data.pluginConfigs[record.pluginId] = p.pluginConfig.value; else delete data.pluginConfigs[record.pluginId];
    if (!Object.keys(data.pluginConfigs).length) delete data.pluginConfigs;
    writeAtomic(settingsPath(), JSON.stringify(data, null, s.indent) + '\n');
    out.push('settings.json: autoMemoryDirectory and the plugin settings put back to how they were before setup');
  }
  const f = claudeMdPath();
  if (record.claudeMd && fs.existsSync(f)) {
    const t = fs.readFileSync(f, 'utf8');
    const re = new RegExp(`\\n*${MARK_START}[\\s\\S]*?${MARK_END}\\n?`);
    if (re.test(t)) { writeAtomic(f, t.replace(re, '\n').replace(/^\n+/, '').replace(/\n{2,}$/, '\n')); out.push('CLAUDE.md: memory save rule removed'); }
  }
  fs.unlinkSync(undoPath());
  out.push('your memory folder, notes and git repo were NOT touched');
  return out;
}

module.exports = { plan, apply, undo, parseArgs, MARK_START, MARK_END };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  try {
    if (mode === 'plan') console.log(JSON.stringify(plan(args), null, 2));
    else if (mode === 'apply') apply(args).forEach((l) => console.log(l));
    else if (mode === 'undo') undo().forEach((l) => console.log(l));
    else { console.log('usage: node setup.js plan|apply|undo [options] (see the top of this file)'); process.exit(2); }
  } catch (e) { console.log(`SETUP STOPPED: ${e.message}`); process.exit(1); }
}
