'use strict';
// The project index: one line per project, COMPUTED from each note's Log (never hand-written), ranked for the
// folder you are working in and cut to a line budget. It lives between two markers inside MEMORY.md.
const fs = require('fs');
const path = require('path');
const { collect } = require('./note-files');
const { parseLog, computeNow } = require('./note-log');
const { parse } = require('./note-format');

const BEGIN = '<!-- generated:index -->';
const END = '<!-- /generated:index -->';
const MAX_LINES = 40;
const MAX_LINE_CHARS = 170;

// reads a list value from frontmatter: inline ("a, b" or "[a, b]") or "- item" lines under the key
function fmList(fm, key) {
  const lines = (fm || '').split('\n');
  const i = lines.findIndex((l) => new RegExp('^\\s*' + key + ':').test(l));
  if (i < 0) return [];
  const inline = lines[i].replace(new RegExp('^\\s*' + key + ':\\s*'), '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(/\s*[,;|]\s*/).map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) out.push(lines[j].replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, '').trim());
  return out;
}
const fmOne = (fm, key) => { const m = new RegExp('^\\s*' + key + ':\\s*(.*)$', 'm').exec(fm || ''); return m ? m[1].replace(/^["']|["']$/g, '').trim() : ''; };
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// every note in a folder that has a Log: name, path, last activity, open counts, status, folders, aliases
function projects(brainDir) {
  const out = [];
  for (const file of collect(brainDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const log = parseLog(text);
    if (!log.has || log.errors.length) continue;
    const fm = parse(text).fm || '';
    const entries = log.entries;
    const closed = new Set(entries.flatMap((e) => e.closes));
    const replaced = new Set(entries.flatMap((e) => e.replaces));
    const newest = [...entries].sort((a, b) => b.n - a.n);
    const status = newest.find((e) => e.tag === 'STATUS' && !replaced.has(e.id));
    out.push({
      file,
      rel: path.relative(brainDir, file).replace(/\\/g, '/'),
      name: fmOne(fm, 'name') || path.basename(file, '.md'),
      last: newest.length ? newest[0].date : '',
      failed: entries.filter((e) => e.tag === 'FAILED' && !closed.has(e.id)).length,
      todo: entries.filter((e) => e.tag === 'TODO' && !closed.has(e.id)).length,
      open: newest.filter((e) => (e.tag === 'FAILED' || e.tag === 'TODO') && !closed.has(e.id)).map((e) => ({ id: e.id, tag: e.tag, text: e.text })),
      status: status ? status.text : fmOne(fm, 'description'),
      folders: fmList(fm, 'folders').map(norm),
      aliases: fmList(fm, 'aliases'),
    });
  }
  return out;
}

function folderMatch(p, cwd) {
  const c = norm(cwd);
  return !!c && p.folders.some((f) => c === f || c.startsWith(f + '/'));
}

// projects for the folder first (most specific folder first), then the rest by newest activity
function rank(list, cwd) {
  const spec = (p) => Math.max(0, ...p.folders.filter((f) => norm(cwd) === f || norm(cwd).startsWith(f + '/')).map((f) => f.length));
  return [...list].sort((a, b) => {
    const ma = folderMatch(a, cwd); const mb = folderMatch(b, cwd);
    if (ma !== mb) return ma ? -1 : 1;
    if (ma && mb && spec(a) !== spec(b)) return spec(b) - spec(a);
    return (b.last || '').localeCompare(a.last || '');
  });
}

function line(p, here) {
  const bits = [`[${p.name}](${p.rel})`, p.last ? 'last ' + p.last.slice(5, 10).replace('-', '/') : 'no entries'];
  if (p.failed) bits.push(`${p.failed} FAILED`);
  if (p.todo) bits.push(`${p.todo} TODO`);
  const head = `- ${here ? '* ' : ''}${bits.join(' · ')} · `;
  const room = Math.max(20, MAX_LINE_CHARS - head.length);
  const st = (p.status || '').replace(/\s+/g, ' ').trim();
  return head + (st.length > room ? st.slice(0, room - 1) + '…' : st);
}

// the block between the markers; `cwd` ranks the matching projects first and marks them with "*"
function renderIndex(list, { cwd = '', maxLines = MAX_LINES } = {}) {
  const ranked = rank(list, cwd);
  const shown = ranked.slice(0, maxLines).map((p) => line(p, folderMatch(p, cwd)));
  if (ranked.length > maxLines) shown.push(`- …(${ranked.length - maxLines} more projects; ask memory_index)`);
  return [BEGIN, ...shown, END].join('\n');
}

// puts the block into MEMORY.md text: replaces the marked region, or appends it. Idempotent.
function updateIndexBlock(text, block) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const b = block.split('\n').join(eol);
  const i = text.indexOf(BEGIN);
  const j = text.indexOf(END);
  if (i >= 0 && j > i) return text.slice(0, i) + b + text.slice(j + END.length);
  const heading = `## Projects (generated from each note's Log)${eol}`;
  return text.replace(/\s*$/, '') + eol + eol + heading + b + eol;
}

module.exports = { BEGIN, END, MAX_LINES, projects, rank, renderIndex, updateIndexBlock, fmList, folderMatch };
