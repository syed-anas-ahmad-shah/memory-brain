'use strict';
// The four memory tools, as plain functions: memory_index, memory_search, memory_read, memory_add.
// A staged read, like an editor outline: a cheap skeleton first, then named parts (long values previewed),
// then one exact piece in full. Every handler returns { text, isError }.
const fs = require('fs');
const path = require('path');
const { search, resolve } = require('./memory-search');
const { parse, tokens, lastVerified } = require('./note-format');
const { parseLog, addEntry, TAGS, handEdited } = require('./note-log');
const { projects, renderIndex, updateIndexBlock, fmList, BEGIN } = require('./note-index');

const PREVIEW_LINE = 500; // characters per line before it is cut to a preview
const READ_BUDGET = 9000; // characters per answer before "…(N more characters)"
const NEWER_MAX = 5;

const TOOLS = [
  {
    name: 'memory_index',
    description: 'List the projects in memory, one line each (last activity, open FAILED/TODO, status). Projects for the current folder come first. Use when unsure which note to open, or for "what is happening / what is open / what are we waiting on" (open:true lists every open FAILED and TODO).',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Folder to rank for (default: the session folder).' }, open: { type: 'boolean', description: 'List every open FAILED and TODO entry, newest project first.' } } },
  },
  {
    name: 'memory_search',
    description: 'Find notes and Log entries about anything, in any wording (typos ok). Returns top hits with a one-line snippet. "Words matched" only means the words are present: read the snippet, and if it does not state the answer, say it is not recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Hits to return (default 5).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only Log entries with these tags, e.g. ["FAILED","TODO"].' },
        since: { type: 'string', description: 'Only Log entries on or after this date (YYYY-MM-DD).' },
        project: { type: 'string', description: 'Limit to one project (name or part of it).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read a project note in cheap tiers, cheapest first. No options: Now + Map (older notes: top lines + outline). sections: those sections (long lines previewed). entries: Log entry ids in full. full:true: no previews. Also lists files newer than the note.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name, file name, alias or path under the memory folder.' },
        sections: { type: 'array', items: { type: 'string' } },
        entries: { type: 'array', items: { type: 'string' }, description: 'Entry ids such as "e7".' },
        full: { type: 'boolean' },
      },
      required: ['project'],
    },
  },
  {
    name: 'memory_add',
    description: `Record a dated entry in a project's Log when something finishes, fails, is decided or learned. Tags: ${TAGS.join(', ')}. closes: ids of TODO/FAILED it resolves. replaces: id of an older entry with the same tag. Refuses secrets. Say why for a DECISION.`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        tag: { type: 'string', enum: TAGS },
        text: { type: 'string' },
        closes: { type: 'array', items: { type: 'string' } },
        replaces: { type: 'array', items: { type: 'string' } },
        src: { type: 'string', description: 'Where the proof is (a file or log path).' },
        create: { type: 'boolean', description: 'Create the project note if it does not exist.' },
      },
      required: ['project', 'tag', 'text'],
    },
  },
];

const ok = (text) => ({ text });
const fail = (text) => ({ text, isError: true });

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (e) { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch {} }
}

function inside(brain, file) {
  const r = path.relative(brain, file);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

function preview(text) {
  return text.split('\n').map((l) => (l.length > PREVIEW_LINE ? `${l.slice(0, PREVIEW_LINE)}…(${l.length - PREVIEW_LINE} more characters)` : l)).join('\n');
}
function budget(text, full) {
  if (full || text.length <= READ_BUDGET) return text;
  return `${text.slice(0, READ_BUDGET)}\n…(${text.length - READ_BUDGET} more characters; ask for one section or entry, or pass full:true)`;
}

// files in the project's folders that changed after the note did: "live beats remembered"
function newerFiles(folders, sinceMs) {
  const out = [];
  let seen = 0;
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
  for (const root of folders) {
    const stack = [root];
    while (stack.length && seen < 4000) {
      const d = stack.pop();
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(p); continue; }
        seen++;
        try { const m = fs.statSync(p).mtimeMs; if (m > sinceMs) out.push({ p, m }); } catch {}
      }
    }
  }
  return out.sort((a, b) => b.m - a.m).slice(0, NEWER_MAX);
}

function freshness(doc) {
  const folders = fmList(doc.p.fm || '', 'folders').map((f) => f.replace(/\//g, path.sep));
  if (!folders.length) return '';
  const lv = lastVerified(doc.text);
  const last = doc.log.entries.length ? doc.log.entries.reduce((a, e) => (e.when && e.when > a ? e.when : a), new Date(0)) : null;
  const ref = (lv && lv.getTime()) || (last && last.getTime()) || doc.mtime;
  const files = newerFiles(folders, ref);
  if (!files.length) return '';
  return `\nNewer than this note (live files win over memory, check them):\n${files.map((f) => `- ${f.p} (${new Date(f.m).toISOString().slice(0, 16).replace('T', ' ')})`).join('\n')}`;
}

function suggestions(brain, ref, list) {
  return `No note matches "${ref}".${list.length ? ' Closest: ' + list.slice(0, 4).join(', ') + '. Call again with one of these paths as project.' : ' Try memory_search.'}`;
}

const OPEN_MAX_LINES = 45;
function openItems(list) {
  const rows = list.filter((p) => p.open.length).sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0));
  const lines = [];
  for (const p of rows) {
    lines.push(`${p.rel} · ${p.name}`);
    for (const o of p.open) lines.push(`  ${o.id} ${o.tag}: ${o.text.length > 150 ? o.text.slice(0, 150) + '…' : o.text}`);
  }
  if (!lines.length) return 'Nothing is open: no FAILED or TODO entry in any project.';
  const shown = lines.slice(0, OPEN_MAX_LINES);
  const more = lines.length - shown.length;
  return `Open FAILED and TODO entries (${rows.length} projects, newest activity first):\n${shown.join('\n')}${more > 0 ? `\n…(${more} more lines: memory_read a project for its full list)` : ''}`;
}

function handleIndex(brain, args, ctx) {
  const list = projects(brain);
  if (args.open) return ok(openItems(list));
  const all = require('./memory-search').allDocs(brain).filter((d) => !d.isArchive);
  const older = all.filter((d) => !d.log.has).length;
  const block = list.length ? renderIndex(list, { cwd: args.cwd || ctx.cwd || '' }).split('\n').filter((l) => l.startsWith('- ')).join('\n') : '(no project has a Log yet)';
  return ok(`${block}\n${older} older note(s) have no Log yet: use memory_search to find them.`);
}

function handleSearch(brain, args) {
  const query = String(args.query || '').trim();
  if (!query && !(args.tags && args.tags.length)) return fail('give a query');
  const r = search(brain, query, { limit: args.limit || 5, tags: args.tags, since: args.since, project: args.project });
  if (!r.hits.length) return ok(`No note matched "${query}". Nothing about it is recorded.`);
  const head = r.confident ? `Words matched (coverage ${r.coverage}).` : `Weak match (coverage ${r.coverage}): probably not recorded.`;
  const lines = r.hits.map((h, i) => {
    const ent = h.entries.map((e) => `\n   ${e.id} ${e.tag} ${e.date.slice(0, 10)}: ${e.text}`).join('');
    return `${i + 1}. ${h.rel}${h.archive ? ' (archive)' : ''}${h.edited ? ' (EDITED BY HAND after its last Log entry: read the note body too)' : ''} · ${h.title}\n   ${h.snippet}${ent}`;
  });
  return ok(`${head}\n${lines.join('\n')}\nIf no snippet states the answer, say it is not recorded. Open a note with memory_read.`);
}

function outline(doc) {
  const rows = doc.p.sections.slice(0, 25).map((s) => `| ${s.title} | ${s.start + 1}-${s.end} | ${tokens(s.body.join('\n'))} |`);
  return `| Section | Lines | ~Tokens |\n|---|---|---|\n${rows.join('\n')}`;
}

function handleRead(brain, args) {
  const r = resolve(brain, args.project);
  if (!r.doc) return fail(suggestions(brain, args.project, r.suggestions || []));
  const doc = r.doc;
  const head = `# ${doc.rel} (~${tokens(doc.text)} tokens whole)`;
  let body;
  if (args.entries && args.entries.length) {
    const want = new Set(args.entries.map((e) => String(e).toLowerCase()));
    const found = doc.log.entries.filter((e) => want.has(e.id));
    const missing = [...want].filter((id) => !found.some((e) => e.id === id));
    body = found.map((e) => doc.p.lines[e.line - 1]).join('\n') + (missing.length ? `\nNo such entry: ${missing.join(', ')}` : '');
  } else if (args.sections && args.sections.length) {
    const parts = [];
    for (const name of args.sections) {
      const k = String(name).toLowerCase();
      const hit = doc.p.sections.filter((s) => s.key === k || s.title.toLowerCase().startsWith(k) || s.key.includes(k));
      if (!hit.length) parts.push(`No section "${name}". Sections: ${doc.p.sections.map((s) => s.title).join('; ')}`);
      else for (const s of hit) parts.push(args.full ? s.body.join('\n') : preview(s.body.join('\n')));
    }
    body = parts.join('\n\n');
  } else {
    const secs = doc.p.sections;
    const now = secs.find((s) => s.key === 'now');
    if (now) {
      const firstOther = secs.find((s) => !['now', 'map'].includes(s.key));
      body = doc.p.lines.slice(now.start, firstOther ? firstOther.start : doc.p.lines.length).join('\n').trim();
    } else {
      const lines = doc.p.lines.slice(doc.p.bodyStart);
      body = `${doc.desc ? 'Description: ' + doc.desc + '\n' : ''}${preview(lines.slice(0, 40).join('\n'))}\n\nOutline (older note, ask for a section by name):\n${outline(doc)}`;
    }
  }
  return ok(`${head}${handWarning(doc)}\n${budget(body, args.full)}${freshness(doc)}`);
}

// A note whose body was changed by hand after its newest Log entry has a Now block that may be out of date.
function handWarning(doc) {
  if (!doc.log.has || !handEdited(doc.text).edited) return '';
  const newest = doc.log.entries.reduce((m, e) => (e.n > m.n ? e : m), { n: 0, id: 'none' });
  const parts = doc.p.sections.filter((s) => !['now', 'map', 'log', 'archive'].includes(s.key)).slice(0, 12).map((s) => `${s.title} (~${tokens(s.body.join('\n'))} tokens)`);
  return `\nWARNING: this note was edited by hand after its newest Log entry (${newest.id}). The Now block below may be out of date. Also read the newer text (memory_read with sections: ${parts.length ? parts.join('; ') : 'none listed'}): the newest facts may be there and not in Now.`;
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function handleAdd(brain, args) {
  let r = resolve(brain, args.project);
  let file;
  let text;
  if (r.doc) {
    file = r.doc.file;
    text = fs.readFileSync(file, 'utf8');
  } else if (args.create) {
    const s = slug(args.project);
    if (!s) return fail('cannot make a note name from that project');
    file = path.join(brain, 'projects', `project_${s}.md`);
    if (fs.existsSync(file)) return fail(`${path.relative(brain, file)} already exists; use its name`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    text = `---\nname: ${s}\ndescription: "${String(args.project).replace(/"/g, "'")}. Status: new, no STATUS entry yet."\nmetadata:\n  type: project\n---\n`;
  } else return fail(suggestions(brain, args.project, r.suggestions || []) + ' Pass create:true to start a new project note.');
  if (!inside(brain, file)) return fail('refused: the note is outside the memory folder');
  const a = addEntry(text, { tag: args.tag, text: args.text, closes: args.closes || [], replaces: args.replaces || [], src: args.src || '' });
  if (!a.ok) return fail('Not added:\n' + a.errors.map((e) => '- ' + e).join('\n'));
  atomicWrite(file, a.text);
  const memory = path.join(brain, 'MEMORY.md');
  try { // keep the generated index current, but only where the owner already has the block
    const mem = fs.readFileSync(memory, 'utf8');
    if (mem.includes(BEGIN)) atomicWrite(memory, updateIndexBlock(mem, renderIndex(projects(brain))));
  } catch {}
  const log = parseLog(a.text);
  const closed = new Set(log.entries.flatMap((e) => e.closes));
  const failed = log.entries.filter((e) => e.tag === 'FAILED' && !closed.has(e.id)).length;
  const todo = log.entries.filter((e) => e.tag === 'TODO' && !closed.has(e.id)).length;
  const warn = a.warnings.length ? '\n' + a.warnings.map((w) => 'warning: ' + w).join('\n') : '';
  return ok(`Added ${a.entry.id} (${a.entry.tag}) to ${path.relative(brain, file).replace(/\\/g, '/')}. Open: ${failed} FAILED, ${todo} TODO.${warn}`);
}

const HANDLERS = { memory_index: handleIndex, memory_search: handleSearch, memory_read: handleRead, memory_add: handleAdd };

function call(name, args, ctx) {
  const brain = ctx && ctx.brain;
  if (!brain || !fs.existsSync(brain)) return fail('The memory folder is not set or does not exist. Set brain_dir in the memory-brain plugin settings (or MEMORY_BRAIN_DIR).');
  const h = HANDLERS[name];
  if (!h) return fail(`unknown tool ${name}`);
  args = { ...(args || {}) };
  if (name === 'memory_read' || name === 'memory_add') {
    // models sometimes name the note differently; take the first usable string
    const ref = [args.project, args.path, args.note, args.file, args.name, args.rel].find((v) => typeof v === 'string' && v.trim());
    if (!ref) return fail('give "project": the note path from memory_search, e.g. projects/project_x.md (or its name).');
    args.project = ref.trim();
  }
  try { return h(brain, args, ctx || {}); } catch (e) { return fail(`${name} failed: ${e.message}`); }
}

module.exports = { TOOLS, call };
