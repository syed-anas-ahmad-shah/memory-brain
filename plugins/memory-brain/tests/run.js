#!/usr/bin/env node
// Memory Brain tests: node plugins/memory-brain/tests/run.js [--parity <old-tools-dir>]
// Every test runs on a fake clean machine: empty temp HOME, isolated git config, a throwaway memory repo
// and a local bare repo as the backup address. --parity also runs the older PowerShell secret-scan.ps1 and
// memory-check.ps1 on the same fixtures and checks both give the same pass/fail.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const scripts = path.join(root, 'scripts');
let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? `\n     ${String(detail).trim().split('\n').join('\n     ')}` : '')); }
}

// fake secrets are assembled at run time so this file never holds a real-looking one
const FAKE_GH = 'gh' + 'p_' + 'Q7'.repeat(18);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-brain-test-'));
const fwd = (p) => p.replace(/\\/g, '/');

function cleanEnv(home, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^CLAUDE_|^GIT_|^GH_/.test(k)) env[k] = v;
  fs.writeFileSync(path.join(home, '.gitconfig-empty'), '');
  return { ...env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig-empty'), GIT_CONFIG_NOSYSTEM: '1', MEMORY_BRAIN_NO_BACKGROUND: '1', ...extra };
}

function note(dir, name, type, body = 'A short fact.') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `---\nname: ${name.replace(/\.md$/, '')}\ndescription: "test note ${name}"\nmetadata:\n  type: ${type}\n---\n\n${body}\n`);
}

let n = 0;
function fixture() {
  const base = path.join(tmp, `f${++n}`);
  const home = path.join(base, 'home');
  const repo = path.join(base, 'memory');
  const brain = path.join(repo, 'brain');
  const remote = path.join(base, 'backup.git');
  fs.mkdirSync(home, { recursive: true });
  note(path.join(brain, 'feedback'), 'feedback_one.md', 'feedback');
  note(path.join(brain, 'reference'), 'reference_one.md', 'reference');
  note(path.join(brain, 'projects'), 'project_one.md', 'project');
  note(path.join(brain, 'archive'), 'project_old.md', 'project');
  fs.writeFileSync(path.join(brain, 'MEMORY.md'), '# Memory index\n- [One](feedback/feedback_one.md) - a rule\n- [Ref](reference/reference_one.md) - a pointer\n- [Proj](projects/project_one.md) - a project\n');
  const env = cleanEnv(home, {
    CLAUDE_PLUGIN_DATA: path.join(base, 'data'),
    CLAUDE_PLUGIN_OPTION_BRAIN_DIR: brain,
    CLAUDE_PLUGIN_OPTION_BACKUP_REMOTE: fwd(remote),
    CLAUDE_PLUGIN_OPTION_COMMIT_NAME: 'Test Owner',
    CLAUDE_PLUGIN_OPTION_COMMIT_EMAIL: 'test@example.invalid',
  });
  const g = (args, cwd = repo) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run('make-catalog.js', env);
  g(['init', '-q', '-b', 'master']);
  g(['add', '-A']);
  g(['-c', 'user.name=Test Owner', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'start']);
  g(['init', '-q', '--bare', remote], base);
  return { base, home, repo, brain, remote, env, g };
}

function run(script, env, args = [], input = '') {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { env, encoding: 'utf8', input, timeout: 60e3 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function badgeOf(env) {
  const r = run('session-start.js', env);
  try { return { code: r.code, line: JSON.parse(r.out).hookSpecificOutput.additionalContext.split('\n').pop(), raw: r.out }; } catch { return { code: r.code, line: '', raw: r.out }; }
}
const remoteHead = (f) => { try { return f.g(['rev-parse', 'refs/heads/master'], f.remote); } catch { return ''; } };
const daysAgo = (file, d) => { const t = (Date.now() - d * 86400e3) / 1000; fs.utimesSync(file, t, t); };

// ---- plugin files are valid and generic
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
check('plugin.json: name memory-brain, semver version', plugin.name === 'memory-brain' && /^\d+\.\d+\.\d+$/.test(plugin.version));
check('plugin.json: userConfig has the 6 settings', ['brain_dir', 'backup_remote', 'stale_days', 'gh_account', 'commit_name', 'commit_email'].every((k) => plugin.userConfig[k]));
const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
check('SessionStart and Stop hooks registered', Object.keys(hooks).sort().join() === 'SessionStart,Stop');
for (const ev of Object.values(hooks)) for (const h of ev[0].hooks) {
  check(`hook script exists: ${h.args[0]}`, h.command === 'node' && fs.existsSync(h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', root)));
}
const market = JSON.parse(fs.readFileSync(path.join(root, '..', '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
check('marketplace lists the plugin', market.plugins.some((p) => p.name === plugin.name));
const personal = /[A-Z]:[\\/](claude|n8n|Users)\b/i;
const codeFiles = ['scripts', 'scripts/lib', 'scripts/git-hooks', 'hooks'].flatMap((d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(root, d, e.name)));
const leaks = codeFiles.filter((f) => personal.test(fs.readFileSync(f, 'utf8')));
check('no personal paths, names or accounts in scripts and hooks', leaks.length === 0, leaks.join('\n'));

// ---- not set up: clean machine, nothing configured
{
  const home = path.join(tmp, 'empty-home'); fs.mkdirSync(home);
  const b = badgeOf(cleanEnv(home));
  check('clean machine: hook exits 0 with valid JSON', b.code === 0 && b.line !== '', b.raw);
  check('clean machine: badge says not set up + how to fix', b.line.includes('Memory !') && b.line.includes('not set up') && b.line.includes('/memory-brain:setup'), b.line);
  check('clean machine: stop-log is silent and exits 0', (() => { const r = run('stop-log.js', cleanEnv(home), [], '{}'); return r.code === 0 && r.out === ''; })());
}

// ---- settings: saved pluginConfigs used when no env; env wins
{
  const f = fixture();
  const env = { ...f.env }; delete env.CLAUDE_PLUGIN_OPTION_BRAIN_DIR;
  fs.mkdirSync(path.join(f.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.claude', 'settings.json'), JSON.stringify({ pluginConfigs: { 'memory-brain@memory-brain-market': { options: { brain_dir: f.brain } } } }));
  check('settings: reads pluginConfigs from ~/.claude/settings.json', badgeOf(env).line.includes('live notes'));
  const empty = path.join(f.base, 'nowhere'); fs.mkdirSync(empty);
  check('settings: env var overrides saved value', badgeOf({ ...env, CLAUDE_PLUGIN_OPTION_BRAIN_DIR: empty }).line.includes('not set up'));
}

// ---- secret scan
{
  const f = fixture();
  let r = run('secret-scan.js', f.env, ['--repo', f.repo]);
  check('secret scan: clean repo passes', r.code === 0 && /clean \(\d+ files\)/.test(r.out), r.out);
  fs.appendFileSync(path.join(f.brain, 'reference', 'reference_one.md'), `\ntoken ${FAKE_GH}\n`);
  r = run('secret-scan.js', f.env, ['--repo', f.repo, '--staged']);
  check('secret scan --staged: unstaged secret not scanned', r.code === 0, r.out);
  f.g(['add', '-A']);
  r = run('secret-scan.js', f.env, ['--repo', f.repo, '--staged']);
  check('secret scan --staged: staged secret blocked', r.code === 1 && r.out.includes('github-token'), r.out);
  r = run('secret-scan.js', f.env, ['--repo', f.repo]);
  check('secret scan: planted token fails with file:line', r.code === 1 && r.out.includes('brain/reference/reference_one.md:10'), r.out);
  check('secret scan: finding is masked', !r.out.includes(FAKE_GH) && r.out.includes('starts "ghp_..."'));
  fs.mkdirSync(path.join(f.repo, '.memory-brain'));
  fs.writeFileSync(path.join(f.repo, '.memory-brain', 'secret-allowlist.txt'), '# path|pattern|reason\nbrain/reference/reference_one.md|github-token|dead test token\n');
  r = run('secret-scan.js', f.env, ['--repo', f.repo]);
  check('secret scan: allowlist entry accepts it', r.code === 0, r.out);
}

// ---- health check
{
  const f = fixture();
  let r = run('memory-check.js', f.env);
  check('memory-check: healthy brain passes', r.code === 0 && r.out.includes('ALL CHECKS PASSED'), r.out);
  const idx = path.join(f.brain, 'MEMORY.md');
  const good = fs.readFileSync(idx, 'utf8');
  fs.writeFileSync(idx, good + ('x'.repeat(150) + '\n').repeat(200));
  r = run('memory-check.js', f.env);
  check('memory-check: no index limits (200 long lines pass)', r.code === 0 && r.out.includes('ALL CHECKS PASSED'), r.out);
  fs.writeFileSync(idx, good + '- [Gone](projects/missing.md) - broken\n');
  check('memory-check: broken index link fails', /FAIL\s+index links resolve/.test(run('memory-check.js', f.env).out));
  fs.writeFileSync(idx, good);
  note(path.join(f.brain, 'projects'), 'project_big.md', 'project', 'y'.repeat(50000));
  r = run('memory-check.js', f.env);
  check('memory-check: no note size limit (50 KB note, only the catalog check fails)', r.out.split('\n').filter((l) => l.startsWith('FAIL')).join() === r.out.split('\n').find((l) => /^FAIL\s+every file in CATALOG/.test(l)), r.out);
  check('memory-check: note missing from CATALOG fails', /FAIL\s+every file in CATALOG/.test(r.out), r.out);
  run('make-catalog.js', f.env);
  check('make-catalog: fixes the CATALOG check', /PASS\s+every file in CATALOG/.test(run('memory-check.js', f.env).out));
}

// ---- backup
{
  const f = fixture();
  note(path.join(f.brain, 'feedback'), 'feedback_two.md', 'feedback');
  fs.appendFileSync(path.join(f.brain, 'MEMORY.md'), '- [Two](feedback/feedback_two.md) - another\n');
  run('make-catalog.js', f.env);
  let r = run('backup.js', f.env);
  const local = f.g(['rev-parse', 'HEAD']);
  check('backup: commits and pushes, verified', r.code === 0 && r.out.includes(`pushed and verified: ${local}`) && remoteHead(f) === local, r.out);
  check('backup: commit uses configured author', f.g(['log', '-1', '--format=%an <%ae>']) === 'Test Owner <test@example.invalid>');
  check('backup: installs the secret guard hooks', fs.existsSync(path.join(f.repo, '.git', 'hooks', 'pre-commit')) && fs.existsSync(path.join(f.repo, '.git', 'hooks', 'memory-brain-secret-scan.js')));
  r = run('backup.js', f.env);
  check('backup: second run, nothing new, still verified', r.code === 0 && r.out.includes('nothing new to commit') && r.out.includes('pushed and verified'), r.out);

  // a brand-new note (CATALOG.md is now stale) must not block the backup: the backup refreshes the generated catalog first
  note(path.join(f.brain, 'projects'), 'project_brand_new.md', 'project');
  fs.appendFileSync(path.join(f.brain, 'MEMORY.md'), '- [New](projects/project_brand_new.md) - just added\n');
  check('catalog is stale after a new note (precondition)', /FAIL\s+every file in CATALOG/.test(run('memory-check.js', f.env).out));
  r = run('backup.js', f.env);
  check('backup: a new note does not block it (catalog refreshed first)', r.code === 0 && r.out.includes('committed:') && /project_brand_new/.test(fs.readFileSync(path.join(f.brain, 'CATALOG.md'), 'utf8')), r.out);

  const before = remoteHead(f);
  const local2 = f.g(['rev-parse', 'HEAD']);
  fs.appendFileSync(path.join(f.brain, 'feedback', 'feedback_two.md'), `\nkey ${FAKE_GH}\n`);
  r = run('backup.js', f.env);
  check('backup: planted secret blocks it, nothing pushed', r.code === 1 && r.out.includes('secret scan failed') && remoteHead(f) === before && f.g(['rev-parse', 'HEAD']) === local2, r.out);
  check('backup: failure output never shows the secret', !r.out.includes(FAKE_GH));
  f.g(['checkout', '-q', '--', '.']);

  f.g(['add', '-A']);
  let blocked = false;
  fs.appendFileSync(path.join(f.brain, 'feedback', 'feedback_two.md'), `\nkey ${FAKE_GH}\n`);
  f.g(['add', '-A']);
  try { f.g(['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'leak']); } catch { blocked = true; }
  check('git pre-commit guard blocks a direct commit with a secret', blocked && f.g(['rev-parse', 'HEAD']) === local2);
  f.g(['reset', '-q', '--hard']);

  r = run('backup.js', { ...f.env, CLAUDE_PLUGIN_OPTION_BACKUP_REMOTE: fwd(path.join(f.base, 'no-such-remote.git')) });
  check('backup: broken remote fails loudly', r.code === 1 && r.out.includes('BACKUP FAILED: push failed'), r.out);
  r = run('backup.js', { ...f.env, CLAUDE_PLUGIN_OPTION_BACKUP_REMOTE: '' });
  check('backup: no address = local-only commit', r.code === 0 && /local only: [0-9a-f]{40}/.test(r.out), r.out);
}

// ---- background worker + badge
{
  const f = fixture();
  let r = run('maintenance.js', f.env);
  const last = fs.readFileSync(path.join(f.base, 'data', 'last-run.txt'), 'utf8');
  check('maintenance: writes backup ok to last-run', r.code === 0 && /^\d\d-\d\d \d\d:\d\d \| backup ok [0-9a-f]{7}/.test(last), last + r.out);
  let b = badgeOf(f.env);
  check('badge: healthy = Memory OK with real facts', /^\u{1F9E0} Memory OK \u00B7 saved \d+ min ago \u00B7 backup ok \(\d\d-\d\d \d\d:\d\d\) \u00B7 3 live notes$/u.test(b.line), b.line);
  check('badge: hook output under the 10,000-char cap', b.raw.length < 10000);
  daysAgo(path.join(f.brain, 'projects', 'project_one.md'), 45);
  check('badge: counts stale project notes', badgeOf(f.env).line.endsWith('3 live notes \u00B7 1 stale'), badgeOf(f.env).line);
  check('badge: stale_days setting respected', !badgeOf({ ...f.env, CLAUDE_PLUGIN_OPTION_STALE_DAYS: '60' }).line.includes('stale'));

  // 0.3.0: STATE.md is retired. A leftover copy with an old review date must not raise a problem or count as a note.
  fs.writeFileSync(path.join(f.brain, 'STATE.md'), '# STATE\nReview date: 2020-01-01\n');
  b = badgeOf(f.env);
  check('badge: a leftover STATE.md is ignored (no review-date problem, not counted)', b.line.startsWith('\u{1F9E0} Memory OK') && !/STATE/.test(b.line) && b.line.includes('3 live notes'), b.line);
  fs.rmSync(path.join(f.brain, 'STATE.md'));

  daysAgo(path.join(f.base, 'data', 'last-run.txt'), 3);
  check('badge: no backup for 48h = Memory !', badgeOf(f.env).line.includes('Memory ! \u00B7 no backup for 48h+'));

  r = run('maintenance.js', { ...f.env, CLAUDE_PLUGIN_OPTION_BACKUP_REMOTE: fwd(path.join(f.base, 'missing.git')) });
  b = badgeOf(f.env);
  check('maintenance: failed backup recorded', fs.readFileSync(path.join(f.base, 'data', 'last-run.txt'), 'utf8').includes('BACKUP PROBLEM'));
  check('badge: failed backup = Memory ! + backup FAILED', b.line.includes('Memory ! \u00B7 backup problem at') && b.line.includes('backup FAILED'), b.line);

  fs.writeFileSync(path.join(f.base, 'data', 'run.lock'), '1');
  fs.writeFileSync(path.join(f.base, 'data', 'last-run.txt'), 'old\n');
  run('maintenance.js', f.env);
  check('maintenance: skips while another run holds the lock', fs.readFileSync(path.join(f.base, 'data', 'last-run.txt'), 'utf8') === 'old\n');

  r = run('stop-log.js', f.env, [], JSON.stringify({ session_id: 'abc-123', cwd: 'C:/work\tdir' }));
  const log = fs.readFileSync(path.join(f.repo, 'log', 'session-log.tsv'), 'utf8');
  check('stop-log: appends time, session, folder; prints nothing', r.code === 0 && r.out === '' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\tabc-123\tC:\/work dir\n$/.test(log), log);
}

// ---- restore
{
  const f = fixture();
  run('backup.js', f.env);
  const target = path.join(f.base, 'restored');
  let r = run('restore.js', f.env, ['--target', target, '--compare-with', f.repo]);
  check('restore: rebuilds into empty folder and proves it', r.code === 0 && r.out.includes('RESTORE VERIFIED') && /PASS\s+byte-identical/.test(r.out) && !r.out.includes('FAIL'), r.out);
  r = run('restore.js', f.env, ['--target', target]);
  check('restore: refuses a non-empty target', r.code === 1 && r.out.includes('not empty'), r.out);
  r = run('restore.js', f.env, ['--target', path.join(f.base, 'r2'), '--source', fwd(path.join(f.base, 'nope.git'))]);
  check('restore: bad source fails loudly', r.code === 1 && r.out.includes('clone failed'), r.out);
}

// ---- notes saved outside the brain (old default memory folders)
{
  const f = fixture();
  const old = path.join(f.home, '.claude', 'projects', 'proj-x', 'memory');
  note(old, 'before.md', 'project');
  daysAgo(path.join(old, 'before.md'), 1);
  let b = badgeOf(f.env);
  check('stray: notes from before the first run are not flagged', b.line.startsWith('\u{1F9E0} Memory OK'), b.line);
  const later = (file, s) => { const t = Date.now() / 1000 + s; fs.utimesSync(file, t, t); };
  note(old, 'new_fact.md', 'feedback');
  later(path.join(old, 'new_fact.md'), 5);
  fs.writeFileSync(path.join(old, 'MEMORY.md'), '- [x](new_fact.md)\n');
  later(path.join(old, 'MEMORY.md'), 5);
  b = badgeOf(f.env);
  check('stray: a note saved there later = Memory ! with its name', b.line.startsWith('\u{1F9E0} Memory ! · 1 note saved outside the brain (old memory folder): new_fact.md'), b.line);
  note(path.join(f.brain, 'feedback'), 'new_fact.md', 'feedback');
  later(path.join(f.brain, 'feedback', 'new_fact.md'), 10);
  b = badgeOf(f.env);
  check('stray: not flagged once the brain has a same-named copy as new', b.line.startsWith('\u{1F9E0} Memory OK'), b.line);
  later(path.join(old, 'new_fact.md'), 20);
  check('stray: flagged again when the old copy changes after that', badgeOf(f.env).line.includes('saved outside the brain'));
}

// ---- setup (/memory-brain:setup worker)
{
  const MARK = '<!-- memory-brain:start -->';
  const count = (s, sub) => s.split(sub).length - 1;
  function machine(settings) {
    const base = path.join(tmp, `s${++n}`);
    const home = path.join(base, 'home');
    const cdir = path.join(home, '.claude');
    const proj = path.join(cdir, 'projects', 'proj-a', 'memory');
    note(proj, 'a.md', 'feedback');
    note(proj, 'b.md', 'project');
    fs.writeFileSync(path.join(proj, 'c.md'), 'no frontmatter at all\n');
    fs.writeFileSync(path.join(proj, 'MEMORY.md'), '- [Rule A](a.md) - the old hook for a\n');
    if (settings !== undefined) fs.writeFileSync(path.join(cdir, 'settings.json'), settings);
    const env = cleanEnv(home, { CLAUDE_PLUGIN_DATA: path.join(base, 'data') });
    const remote = path.join(base, 'backup.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env });
    return { base, home, cdir, proj, env, remote, brain: path.join(home, 'brain'), settings: () => JSON.parse(fs.readFileSync(path.join(cdir, 'settings.json'), 'utf8')) };
  }
  const setup = (m, args) => run('setup.js', m.env, args);

  const m = machine('{\n  "theme": "dark"\n}\n');
  let r = setup(m, ['plan']);
  let p = {}; try { p = JSON.parse(r.out); } catch {}
  check('setup plan: JSON with suggestion and import candidates', r.code === 0 && p.suggested_brain === path.join(m.cdir, 'memory-brain') && p.import_candidates.some((c) => c.notes === 3) && p.repo.kind === 'none', r.out);
  const custom = path.join(m.base, 'custom-claude');
  let pc = {}; try { pc = JSON.parse(run('setup.js', { ...m.env, CLAUDE_CONFIG_DIR: custom }, ['plan']).out); } catch {}
  check('setup plan: follows CLAUDE_CONFIG_DIR, not the home folder', pc.suggested_brain === path.join(custom, 'memory-brain'), pc.suggested_brain);
  check('setup plan: changes nothing', !fs.existsSync(p.suggested_brain || 'x') && m.settings().theme === 'dark' && !fs.existsSync(path.join(m.cdir, 'CLAUDE.md')));

  const full = ['apply', '--brain', m.brain, '--import', m.proj, '--remote', fwd(m.remote), '--first-backup', '--auto-memory', '--claude-md', '--commit-name', 'New User', '--commit-email', 'new@example.invalid'];
  r = setup(m, full);
  check('setup apply: succeeds', r.code === 0 && !r.out.includes('STOPPED'), r.out);
  check('setup apply: starter files + imported notes sorted by type', ['MEMORY.md', 'CATALOG.md', 'feedback/a.md', 'projects/b.md', 'reference/c.md'].every((f) => fs.existsSync(path.join(m.brain, f))), r.out);
  check('setup apply: no STATE.md is created (retired in 0.3.0)', !fs.existsSync(path.join(m.brain, 'STATE.md')), r.out);
  check('setup apply: CLAUDE.md rule names the memory tools, not STATE.md', (() => { const c = fs.readFileSync(path.join(m.cdir, 'CLAUDE.md'), 'utf8'); return /memory_search/.test(c) && /memory_add/.test(c) && !/STATE/.test(c); })());
  check('setup apply: reports note with no type', r.out.includes('no known type, put in reference/: c.md'), r.out);
  check('setup apply: index keeps the old hook text', fs.readFileSync(path.join(m.brain, 'MEMORY.md'), 'utf8').includes('- [Rule A](feedback/a.md) - the old hook for a'));
  let st = m.settings();
  const opts = ((st.pluginConfigs || {})['memory-brain@memory-brain-market'] || {}).options || {};
  check('setup apply: settings keep other keys, gain plugin options', st.theme === 'dark' && opts.brain_dir === fwd(m.brain) && opts.backup_remote === 'origin' && opts.commit_name === 'New User', JSON.stringify(st));
  check('setup apply: autoMemoryDirectory set (opt-in)', st.autoMemoryDirectory === fwd(m.brain));
  check('setup apply: settings.json backed up first', fs.readdirSync(m.cdir).some((f) => /^settings\.json\.memory-brain-.*\.bak$/.test(f)));
  check('setup apply: CLAUDE.md rule added once', count(fs.readFileSync(path.join(m.cdir, 'CLAUDE.md'), 'utf8'), MARK) === 1);
  check('setup apply: first backup pushed and verified', r.out.includes('first backup: pushed and verified') && !!execFileSync('git', ['rev-parse', 'refs/heads/' + execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: m.brain, env: m.env, encoding: 'utf8' }).trim()], { cwd: m.remote, env: m.env, encoding: 'utf8' }).trim(), r.out);
  check('setup apply: health check passes', r.out.includes('health check: all passed'), r.out);
  const b = badgeOf({ ...m.env });
  check('setup apply: badge now Memory OK from saved settings', b.line.startsWith('\u{1F9E0} Memory OK') && b.line.includes('3 live notes'), b.line);

  r = setup(m, full);
  check('setup re-run: harmless (rule once, no duplicate import)', r.code === 0 && count(fs.readFileSync(path.join(m.cdir, 'CLAUDE.md'), 'utf8'), MARK) === 1 && count(fs.readFileSync(path.join(m.brain, 'MEMORY.md'), 'utf8'), '## Imported') === 1 && r.out.includes('skipped: a.md'), r.out);

  r = setup(m, ['undo']);
  st = m.settings();
  check('setup undo: settings back to before', r.code === 0 && st.theme === 'dark' && !('autoMemoryDirectory' in st) && !('pluginConfigs' in st), JSON.stringify(st) + r.out);
  check('setup undo: CLAUDE.md rule removed, notes kept', !fs.readFileSync(path.join(m.cdir, 'CLAUDE.md'), 'utf8').includes(MARK) && fs.existsSync(path.join(m.brain, 'feedback', 'a.md')));
  check('setup undo: second undo has nothing to do', setup(m, ['undo']).out.includes('nothing to undo'));

  const m2 = machine('{"autoMemoryDirectory": "X:/old-memory", "pluginConfigs": {"memory-brain@mkt": {"options": {"stale_days": 9}}}}');
  setup(m2, ['apply', '--brain', m2.brain, '--auto-memory']);
  setup(m2, ['apply', '--brain', m2.brain, '--auto-memory', '--stale-days', '20']);
  check('setup: keeps existing plugin id and options', m2.settings().pluginConfigs['memory-brain@mkt'].options.stale_days === 20);
  setup(m2, ['undo']);
  st = m2.settings();
  check('setup undo after 2 runs: ORIGINAL values come back', st.autoMemoryDirectory === 'X:/old-memory' && st.pluginConfigs['memory-brain@mkt'].options.stale_days === 9, JSON.stringify(st));

  const m3 = machine('{bad json');
  r = setup(m3, ['apply', '--brain', m3.brain]);
  check('setup: refuses broken settings.json, changes nothing', r.code === 1 && r.out.includes('not valid JSON') && !fs.existsSync(m3.brain) && fs.readFileSync(path.join(m3.cdir, 'settings.json'), 'utf8') === '{bad json', r.out);
  r = setup(machine(), ['apply', '--brain', path.join(tmp, 'x'), '--remote', 'nosuchremote']);
  check('setup: refuses an unknown remote name', r.code === 1 && r.out.includes('neither a git address'), r.out);

  const f = fixture();
  const inside = path.join(f.repo, 'sub');
  r = run('setup.js', f.env, ['apply', '--brain', inside]);
  check('setup: refuses a folder inside another repo', r.code === 1 && r.out.includes('inside another git repo') && !fs.existsSync(inside), r.out);
  r = run('setup.js', f.env, ['apply', '--brain', inside, '--use-parent-repo']);
  check('setup: --use-parent-repo accepts it', r.code === 0 && fs.existsSync(path.join(inside, 'MEMORY.md')), r.out);

  const m4 = machine();
  fs.mkdirSync(m4.brain, { recursive: true });
  fs.writeFileSync(path.join(m4.brain, 'MEMORY.md'), '# my own index\n');
  for (let i = 0; i < 70; i++) note(path.join(m4.base, 'many'), `n${i}.md`, 'reference');
  r = setup(m4, ['apply', '--brain', m4.brain, '--import', path.join(m4.base, 'many')]);
  const idx = fs.readFileSync(path.join(m4.brain, 'MEMORY.md'), 'utf8');
  check('setup: existing MEMORY.md kept', idx.startsWith('# my own index\n'));
  check('setup: big import lists every note in the index', (idx.match(/\]\(reference\/n\d+\.md\)/g) || []).length === 70 && r.out.includes('health check: all passed'), r.out);

  const m5 = machine();
  fs.appendFileSync(path.join(m5.proj, 'a.md'), `\npassword ${FAKE_GH}\n`);
  r = setup(m5, ['apply', '--brain', m5.brain, '--import', m5.proj]);
  check('setup: secret in an imported note is reported, not committed', r.out.includes('COMMIT BLOCKED') && !r.out.includes(FAKE_GH), r.out);
}

// ---- parity with the older PowerShell scripts (optional)
const pi = process.argv.indexOf('--parity');
if (pi > 0) {
  const old = path.resolve(process.argv[pi + 1]);
  const ps = (file, args, env) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(old, file), ...args], { env, encoding: 'utf8' }).status;
  const cases = {
    healthy: () => {},
    'planted secret': (f) => { fs.appendFileSync(path.join(f.brain, 'reference', 'reference_one.md'), `\n${FAKE_GH}\n`); f.g(['add', '-A']); },
    'index 61 lines': (f) => fs.appendFileSync(path.join(f.brain, 'MEMORY.md'), 'x\n'.repeat(60)),
    'note over 4.5 KB': (f) => { note(path.join(f.brain, 'projects'), 'project_big.md', 'project', 'y'.repeat(5000)); run('make-catalog.js', f.env); },
    'missing from catalog': (f) => note(path.join(f.brain, 'feedback'), 'feedback_new.md', 'feedback'),
  };
  for (const [name, plant] of Object.entries(cases)) {
    const f = fixture();
    plant(f);
    const pairs = [
      ['secret-scan', ps('secret-scan.ps1', ['-Repo', f.repo], f.env), run('secret-scan.js', f.env, ['--repo', f.repo]).code],
      ['memory-check', ps('memory-check.ps1', ['-Brain', f.brain], f.env), run('memory-check.js', f.env).code],
    ];
    for (const [tool, a, b] of pairs) check(`parity ${tool} [${name}]: old exit ${a} = new exit ${b}`, a === b);
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
