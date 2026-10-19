#!/usr/bin/env node
// Tests for the search and the four memory tools: node plugins/memory-brain/tests/memory-tools.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { search, resolve } = require('../scripts/lib/memory-search');
const { TOOLS, call } = require('../scripts/lib/memory-tools');
const { addEntry } = require('../scripts/lib/note-log');
const { BEGIN } = require('../scripts/lib/note-index');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + String(detail).split('\n').join('\n     ') : '')); }
}
const FAKE_GH = 'gh' + 'p_' + 'Q7'.repeat(18);
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

// ---- a fake brain
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-tools-'));
const brain = path.join(work, 'brain');
const watched = path.join(work, 'watched-folder');
fs.mkdirSync(watched, { recursive: true });
const fm = (name, desc, extra = '') => `---\nname: ${name}\ndescription: "${desc}"\nmetadata:\n  type: project\n${extra}---\n`;

write(path.join(brain, 'MEMORY.md'), '# Index\n- hand written line\n');
write(path.join(brain, 'STATE.md'), '# STATE\nFocus today: the harbor dredging bid.\n'); // a retired leftover: must never be searched
write(path.join(brain, 'projects', 'project_pricing_plan.md'), fm('pricing-plan', 'Pricing decision: $15 per month flat for the product.', 'aliases: cost, how much, subscription fee\n') + '## Why\n> Reasoning.\nWe kept one flat tier so support stays simple.\n');
write(path.join(brain, 'projects', 'project_docker_setup.md'), fm('docker-setup', 'The server runs in Docker with hourly backups.') + '## Backups\n> Where backups go.\nHourly local backups to the data folder.\n\n## Long\n> long line section.\n' + 'x'.repeat(1200) + '\n');
write(path.join(brain, 'projects', 'project_telescope.md'), fm('telescope', 'Telescope mirror grinding project.') + '## Notes\nGrinding the mirror takes twelve weeks.\n');
write(path.join(brain, 'archive', 'full', 'project_pricing_plan.md'), fm('pricing-plan', 'DUPLICATE ORIGINAL') + 'xylophone unique-dup-word\n');
write(path.join(brain, 'archive', 'old_projects.md'), fm('old', 'Old finished work.') + 'The comet tracker was shelved.\n');
write(path.join(brain, 'archive', 'comet_live.md'), fm('comet-live', 'Comet tracker.') + 'The comet tracker was shelved.\n');
write(path.join(brain, 'projects', 'project_comet_live.md'), fm('comet-notes', 'Comet tracker notes.') + 'The comet tracker was shelved.\n');

// a project with a Log and a watched folder
let film = fm('film', 'Launch film project.', `folders:\n  - ${watched.replace(/\\/g, '/')}\naliases: recording, video\n`) + '## Setup\n> Wiring.\nRobot browser.\n';
const at = (m) => new Date(2026, 9, 18, 10, m);
for (const [tag, text, extra, m] of [
  ['STATUS', 'Footage exists, not edited.', {}, 0],
  ['FAILED', 'B1 take crashed: credentials not attached', {}, 1],
  ['TODO', 'Owner reviews the footage', {}, 2],
  ['FIXED', 'Dry run uses a prebuilt canvas', { closes: ['e2'] }, 3],
]) film = addEntry(film, { tag, text, date: at(m), ...extra }).text;
write(path.join(brain, 'projects', 'project_film.md'), film);
const ctx = { brain, cwd: watched };

// ---- search
{
  const r = search(brain, 'pricing decision');
  check('title/description words rank the note first', r.hits[0] && r.hits[0].rel === 'projects/project_pricing_plan.md', JSON.stringify(r.hits.map((h) => h.rel)));
  check('archive/full duplicates are never returned', !search(brain, 'xylophone').hits.some((h) => h.rel.includes('archive/full')), JSON.stringify(search(brain, 'xylophone').hits));
  const a = search(brain, 'how much does it cost').hits;
  check('alias finds a note whose body lacks the words', a[0] && a[0].rel === 'projects/project_pricing_plan.md', JSON.stringify(a.map((h) => h.rel)));
  check('typo is tolerated', (search(brain, 'telescop mirrror').hits[0] || {}).rel === 'projects/project_telescope.md');
  check('a one-letter misspelling alone still finds the note', (search(brain, 'mirrer').hits[0] || {}).rel === 'projects/project_telescope.md', JSON.stringify(search(brain, 'mirrer').hits.map((h) => h.rel)));
  check('word forms meet (running ~ runs)', (search(brain, 'is it running').hits[0] || {}).rel === 'projects/project_docker_setup.md', JSON.stringify(search(brain, 'is it running').hits.map((h) => h.rel)));
  const c = search(brain, 'comet tracker').hits.map((h) => h.rel);
  check('live note outranks archive with the same text', c.indexOf('projects/project_comet_live.md') < c.indexOf('archive/comet_live.md') && c.indexOf('archive/comet_live.md') < c.indexOf('archive/old_projects.md') + 1, JSON.stringify(c));
  const none = search(brain, 'zeppelin quantum yodel');
  check('unknown words: no confident hit', !none.confident && (none.hits.length === 0 || none.coverage < 0.5), JSON.stringify(none));
  const t = search(brain, '', { tags: ['FAILED'] });
  check('tag filter returns the Log entry', t.hits.length === 1 && t.hits[0].entries[0].id === 'e2', JSON.stringify(t.hits));
  check('since filter excludes older entries', search(brain, '', { tags: ['FAILED'], since: '2026-10-19' }).hits.length === 0);
  check('project filter limits results', search(brain, 'notes', { project: 'telescope' }).hits.every((h) => h.rel.includes('telescope')));
  write(path.join(brain, 'projects', 'project_new_topic.md'), fm('new-topic', 'Freshly written note about narwhals.') + '## A\nnarwhal tusk facts\n');
  check('a new file is found without a restart', (search(brain, 'narwhal').hits[0] || {}).rel === 'projects/project_new_topic.md');
  const r2 = resolve(brain, 'film');
  check('resolve by name', r2.doc && r2.doc.rel === 'projects/project_film.md');
  check('resolve by alias', resolve(brain, 'recording').doc && resolve(brain, 'recording').doc.rel === 'projects/project_film.md');
}

// ---- memory_index
{
  const r = call('memory_index', {}, ctx);
  check('index lists the Log project with counts and ranks it first for its folder', /^- \* \[film\]/.test(r.text) && /1 TODO/.test(r.text) && !/FAILED/.test(r.text), r.text);
  check('index counts older notes', /older note\(s\) have no Log/.test(r.text));
}

// ---- memory_read
{
  const now = call('memory_read', { project: 'film' }, ctx).text;
  check('read: default is Now + Map, not the whole note', now.includes('## Now') && now.includes('## Map') && !now.includes('## Setup'), now);
  const old = call('memory_read', { project: 'project_telescope' }, ctx).text;
  check('read: older note gives top lines + outline', old.includes('Outline') && old.includes('| Notes |'), old);
  const sec = call('memory_read', { project: 'docker-setup', sections: ['backups'] }, ctx).text;
  check('read: named section only', sec.includes('Hourly local backups') && !sec.includes('long line section'), sec);
  const longp = call('memory_read', { project: 'docker-setup', sections: ['long'] }, ctx).text;
  check('read: long lines are previewed', /…\(\d+ more characters\)/.test(longp) && longp.length < 900, `len ${longp.length}`);
  const longf = call('memory_read', { project: 'docker-setup', sections: ['long'], full: true }, ctx).text;
  check('read: full:true returns every character', longf.includes('x'.repeat(1200)));
  const ent = call('memory_read', { project: 'film', entries: ['e2', 'e9'] }, ctx).text;
  check('read: exact entries, and a missing one is named', ent.includes('e2 · 2026-10-18 10:01 · FAILED · B1 take crashed') && ent.includes('No such entry: e9'), ent);
  const miss = call('memory_read', { project: 'nothing-like-this-zzz' }, ctx);
  check('read: unknown project is an error with a hint', miss.isError && /No note matches/.test(miss.text), miss.text);
  const later = new Date(Date.now() + 3600e3);
  write(path.join(watched, 'newer.txt'), 'x');
  fs.utimesSync(path.join(watched, 'newer.txt'), later, later);
  check('read: lists files newer than the note', /Newer than this note[\s\S]*newer\.txt/.test(call('memory_read', { project: 'film' }, ctx).text));
}

// ---- memory_add
{
  const before = fs.readFileSync(path.join(brain, 'MEMORY.md'), 'utf8');
  const r = call('memory_add', { project: 'film', tag: 'FAILED', text: 'Render timed out after 20 s', src: 'live/B2.log' }, ctx);
  check('add: records the entry and reports open counts', !r.isError && /Added e5 \(FAILED\)/.test(r.text) && /1 FAILED, 1 TODO/.test(r.text), r.text);
  check('add: Now is regenerated', /Failed or stuck\*\*\n- Render timed out/.test(call('memory_read', { project: 'film' }, ctx).text));
  check('add: MEMORY.md untouched when it has no generated block', fs.readFileSync(path.join(brain, 'MEMORY.md'), 'utf8') === before);
  const closed = call('memory_add', { project: 'film', tag: 'FIXED', text: 'Render timeout fixed', closes: ['e5'] }, ctx);
  check('add: closes works', !closed.isError && /0 FAILED/.test(closed.text), closed.text);
  const s = call('memory_add', { project: 'film', tag: 'FACT', text: 'token ' + FAKE_GH }, ctx);
  check('add: refuses a secret and writes nothing', s.isError && /secret/.test(s.text) && !fs.readFileSync(path.join(brain, 'projects', 'project_film.md'), 'utf8').includes(FAKE_GH.slice(0, 8)), s.text);
  check('add: bad closes is refused', call('memory_add', { project: 'film', tag: 'FIXED', text: 'x', closes: ['e42'] }, ctx).isError);
  const noNote = call('memory_add', { project: 'does-not-exist', tag: 'DONE', text: 'x' }, ctx);
  check('add: unknown project is refused with a hint', noNote.isError && /create:true/.test(noNote.text), noNote.text);
  const made = call('memory_add', { project: 'Solar Panels', tag: 'STATUS', text: 'Quote requested', create: true }, ctx);
  check('add: create:true starts a new project note inside projects/', !made.isError && fs.existsSync(path.join(brain, 'projects', 'project_solar-panels.md')), made.text);
  const evil = call('memory_add', { project: '../../evil', tag: 'NOTE', text: 'x', create: true }, ctx);
  check('add: path tricks stay inside the memory folder', !fs.existsSync(path.join(work, 'evil.md')) && !fs.existsSync(path.join(brain, '..', 'evil.md')), evil.text);
  write(path.join(brain, 'MEMORY.md'), before + `${BEGIN}\n- stale\n<!-- /generated:index -->\n`);
  call('memory_add', { project: 'film', tag: 'NOTE', text: 'index refresh check' }, ctx);
  check('add: keeps an existing generated index block current', /\[film\]/.test(fs.readFileSync(path.join(brain, 'MEMORY.md'), 'utf8')) && fs.readFileSync(path.join(brain, 'MEMORY.md'), 'utf8').includes('hand written line'));
  check('tools refuse politely when the brain is not set', call('memory_search', { query: 'x' }, { brain: '' }).isError);
}

// ---- the server speaks the protocol
{
  const server = path.join(__dirname, '..', 'scripts', 'mcp-server.js');
  const run = (lines, env = {}) => spawnSync(process.execPath, [server], { input: lines.join('\n') + '\n', encoding: 'utf8', env: { ...process.env, MEMORY_BRAIN_DIR: brain, ...env } });
  const parse = (out) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const r = run([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    'this is not json',
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'pricing' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'bogus/method' }),
    JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
  ]);
  let msgs = [];
  try { msgs = parse(r.stdout); } catch (e) { check('server stdout is only JSON lines', false, r.stdout); }
  const by = (id) => msgs.find((m) => m.id === id);
  check('initialize answers with name and the client protocol version', by(1) && by(1).result.serverInfo.name === 'memory-brain' && by(1).result.protocolVersion === '2025-03-26', JSON.stringify(by(1)));
  check('exactly four tools listed, each with a schema', by(2) && by(2).result.tools.map((t) => t.name).sort().join(',') === 'memory_add,memory_index,memory_read,memory_search' && by(2).result.tools.every((t) => t.inputSchema && t.description), JSON.stringify(by(2)).slice(0, 200));
  check('a malformed line gets a parse error and the server keeps going', msgs.some((m) => m.error && m.error.code === -32700) && by(3), JSON.stringify(msgs.map((m) => m.id)));
  check('tools/call returns text content', by(3) && by(3).result.content[0].text.includes('project_pricing_plan.md'), JSON.stringify(by(3)).slice(0, 200));
  check('unknown tool is a tool error, not a crash', by(4) && by(4).result.isError === true);
  check('unknown method is a JSON-RPC error', by(5) && by(5).error.code === -32601);
  check('ping works and notifications get no reply', by(6) && !msgs.some((m) => m.id === undefined && !m.error));
  const size = JSON.stringify(by(2).result.tools).length;
  check('tool definitions stay small (< 3500 chars, about 900 tokens)', size < 3500, `size ${size}`);
  console.log(`(tool definitions: ${size} chars, about ${Math.round(size / 4)} tokens)`);
  const noBrain = run([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_index', arguments: {} } })], { MEMORY_BRAIN_DIR: path.join(work, 'missing') });
  check('server reports a missing memory folder clearly', /not set or does not exist/.test(noBrain.stdout), noBrain.stdout);
}

// ---- memory_index open:true replaces the hand-kept "next steps / waiting" page
{
  const r = call('memory_index', { open: true }, ctx).text;
  check('open:true lists open TODO entries with their ids', /Open FAILED and TODO entries/.test(r) && /e3 TODO: Owner reviews the footage/.test(r), r);
  check('open:true hides closed entries (the FAILED that was fixed)', !/B1 take crashed/.test(r), r);
  check('open:true is capped', r.split('\n').length <= 47, String(r.split('\n').length));
  check('plain memory_index still lists projects', /film/.test(call('memory_index', {}, ctx).text));
}

// ---- memory_read never hands back a wrong note (found in the answer-quality run: it returned the film note for any phrase)
{
  const nope = (ref) => call('memory_read', { project: ref }, ctx).text;
  check('a sentence of body words is NOT matched to a note', /^No note matches/.test(nope('which extension version is live on the store')), nope('which extension version is live on the store'));
  check('a topic word that only appears in note bodies is NOT matched', /^No note matches/.test(nope('footage')), nope('footage'));
  check('an unknown name says so and offers suggestions or a search hint', /^No note matches/.test(nope('harbor dredging bid xyz')) && /(Call again with one of these paths|Try memory_search)/.test(nope('harbor dredging bid xyz')), nope('harbor dredging bid xyz'));
  check('a reference that contains one note name resolves to that note', /project_pricing_plan/.test(nope('the pricing plan please')), nope('the pricing plan please').slice(0, 100));
  check('the exact path still works', /project_pricing_plan/.test(call('memory_read', { project: 'projects/project_pricing_plan.md' }, ctx).text));
  check('an unambiguous partial name still works', /project_docker_setup/.test(call('memory_read', { project: 'docker' }, ctx).text), call('memory_read', { project: 'docker' }, ctx).text.slice(0, 120));
  check('"path" is accepted instead of "project"', /project_pricing_plan/.test(call('memory_read', { path: 'projects/project_pricing_plan.md' }, ctx).text));
  const none = call('memory_read', {}, ctx);
  check('no note given is an error, not a random note', none.isError === true && /give "project"/.test(none.text), none.text);
  check('memory_add with no project is an error too', call('memory_add', { tag: 'FACT', text: 'x' }, ctx).isError === true);
}

// ---- a leftover STATE.md (retired in 0.3.0) is not searchable and not an index entry
{
  const r = call('memory_search', { query: 'harbor dredging bid' }, ctx).text;
  check('leftover STATE.md is never returned by search', !/STATE\.md/.test(r), r);
  check('memory_index does not list STATE.md', !/STATE/.test(call('memory_index', {}, ctx).text));
}

// ---- hand-edit warning in memory_read and memory_search
{
  const file = path.join(brain, 'projects', 'project_film.md');
  const before = fs.readFileSync(file, 'utf8');
  check('clean note: memory_read has no hand-edit warning', !/edited by hand/i.test(call('memory_read', { project: 'film' }, ctx).text));
  check('clean note: memory_search has no hand-edit flag', !/EDITED BY HAND/.test(call('memory_search', { query: 'launch film footage' }, ctx).text));
  fs.writeFileSync(file, before.replace('> Wiring.', '> Wiring.\nA HAND-WRITTEN NEWER FACT about the film server.'));
  const rd = call('memory_read', { project: 'film' }, ctx).text;
  check('hand-edited note: memory_read warns and names the newest entry', /WARNING: this note was edited by hand/.test(rd) && /\(e\d+\)/.test(rd), rd.slice(0, 400));
  check('the warning lists the sections to read and no longer mentions STATE.md', /Setup/.test(rd) && !/STATE\.md/.test(rd), rd.slice(0, 500));
  check('hand-edited note: memory_search flags the hit', /EDITED BY HAND/.test(call('memory_search', { query: 'launch film footage' }, ctx).text));
  const add2 = call('memory_add', { project: 'film', tag: 'DONE', text: 'Recorded the new film server rehearsal.' }, ctx);
  check('memory_add after the edit clears the warning', !add2.isError && !/edited by hand/i.test(call('memory_read', { project: 'film' }, ctx).text), add2.text);
  check('the hand-written text survived memory_add', fs.readFileSync(file, 'utf8').includes('A HAND-WRITTEN NEWER FACT'));
  fs.writeFileSync(file, before);
}

// ---- no personal paths in the new files
{
  const files = ['scripts/lib/memory-search.js', 'scripts/lib/memory-tools.js', 'scripts/mcp-server.js', '.mcp.json'];
  const bad = files.filter((f) => /[A-Z]:\\\\|\/Users\//i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  check('no personal paths or names in new files', bad.length === 0, bad.join(', '));
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
