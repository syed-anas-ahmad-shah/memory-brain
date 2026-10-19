'use strict';
// Converts an older prose note into a layered note (Log + generated Now/Map) WITHOUT losing a line.
// The judgment (which facts become which entries, the aliases) comes from a spec written by Claude from the note's own text;
// this module does the mechanics and proves that every original line is still there.
//   spec = { aliases: [..], folders: [..], entries: [{ k, d: 'YYYY-MM-DD', t: 'HH:MM', tag, text, closes: [k], replaces: [k], src }] }
const { addEntry, validateNote, parseLog } = require('./note-log');

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const norm = (s) => String(s).replace(/\r\n/g, '\n');
const RESERVED = /^## (Now|Map|Log|Archive)\s*$/gm;

function frontmatter(fm, aliases, folders) {
  const out = [];
  let skip = false;
  for (const l of fm.split('\n')) {
    if (/^(aliases|folders):/.test(l)) { skip = /^folders:\s*$/.test(l); continue; }
    if (skip && /^\s+-\s/.test(l)) continue;
    skip = false;
    if (/^metadata:/.test(l)) {
      if (aliases.length) out.push('aliases: ' + aliases.join(', '));
      if (folders.length) { out.push('folders:'); for (const f of folders) out.push('  - ' + f); }
    }
    out.push(l);
  }
  return '---\n' + out.join('\n') + '\n---\n';
}

// every non-empty original body line must still be in the result (trimmed comparison)
function findLost(body, result) {
  const have = new Set(norm(result).split('\n').map((l) => l.trim()));
  return norm(body).split('\n').map((l) => l.trim()).filter((l) => l && !have.has(l));
}

// Returns { ok, text, errors, warnings, lost, entries }. Never throws on bad input.
function convert(raw, spec, { fallbackDate = new Date() } = {}) {
  const errors = [];
  const text0 = norm(raw);
  const m = FM_RE.exec(text0);
  if (!m) return { ok: false, errors: ['the note has no frontmatter (--- name / description / metadata.type ---)'], warnings: [], lost: [], entries: 0 };
  if (parseLog(text0).has) return { ok: false, errors: ['the note already has a Log: nothing to convert'], warnings: [], lost: [], entries: 0 };
  if (!spec || !Array.isArray(spec.entries) || !spec.entries.length) return { ok: false, errors: ['the spec needs at least one entry'], warnings: [], lost: [], entries: 0 };

  const body = text0.slice(m[0].length).replace(/^\n+/, '');
  // text before the first heading becomes an Overview section; headings stay as detail sections
  const firstH = body.search(/^## /m);
  let detail;
  if (firstH === -1) detail = body.trim() ? '## Overview\n> The note text before the Log was introduced.\n' + body.trim() + '\n' : '';
  else {
    const intro = body.slice(0, firstH).trim();
    detail = (intro ? '## Overview\n> Links and context for this note.\n' + intro + '\n\n' : '') + body.slice(firstH).trim() + '\n';
  }
  detail = detail.replace(RESERVED, '## Old $1'); // the validator wants unique, non-reserved titles ("Now (old)" would still count as Now)
  const aliases = (spec.aliases || []).map(String).filter(Boolean);
  const folders = (spec.folders || []).map(String).filter(Boolean);
  let text = frontmatter(m[1], aliases, folders) +
    '## Log\n> Dated entries, newest first. The only hand-written part: Now and Map are computed from it.\n\n' +
    (detail ? detail + '\n' : '') + '## Archive\n\nSee the detail sections above.\n';

  const ids = {};
  const warnings = [];
  for (const [i, e] of spec.entries.entries()) {
    const label = e.k || `#${i + 1}`;
    const day = e.d || fallbackDate.toISOString().slice(0, 10);
    const when = new Date(`${day}T${e.t || '12:00'}:00`);
    if (Number.isNaN(when.getTime())) { errors.push(`entry ${label}: bad date "${day} ${e.t || ''}"`); continue; }
    const refs = (list, what) => (list || []).map((k) => { if (!(k in ids)) errors.push(`entry ${label}: ${what} "${k}" is not an earlier entry key`); return ids[k]; });
    const closes = refs(e.closes, 'closes');
    const replaces = refs(e.replaces, 'replaces');
    if (errors.length) continue;
    const r = addEntry(text, { tag: e.tag, text: e.text, src: e.src || '', date: when, closes, replaces });
    if (!r.ok) { errors.push(`entry ${label}: ${r.errors.join('; ')}`); continue; }
    warnings.push(...r.warnings.map((w) => `entry ${label}: ${w}`));
    ids[e.k || `#${i + 1}`] = r.entry.id;
    text = r.text;
  }
  if (errors.length) return { ok: false, errors, warnings, lost: [], entries: 0 };

  const v = validateNote(text);
  const bodyForCheck = body.replace(RESERVED, '## Old $1');
  const lost = findLost(bodyForCheck, text);
  const problems = [...v.errors, ...(lost.length ? [`${lost.length} original line(s) would be lost, first: ${lost[0].slice(0, 80)}`] : [])];
  return { ok: problems.length === 0, text, errors: problems, warnings: [...warnings, ...v.warnings], lost, entries: v.entries || spec.entries.length };
}

module.exports = { convert, findLost };
