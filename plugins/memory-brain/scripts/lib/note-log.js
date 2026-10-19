'use strict';
// The Log: the ONLY hand-written part of a project note. Every other view (Now, Map, the index) is computed from it,
// the way a build tool computes a view from the source instead of keeping a summary that drifts.
// Entry line:  - e14 · 2026-10-18 15:00 · FAILED · text · closes e7 · replaces e3 · src: path
const { parse, withMap, validate } = require('./note-format');
const { PATTERNS } = require('../secret-scan');

const TAGS = ['STATUS', 'DONE', 'DECISION', 'FAILED', 'FIXED', 'TODO', 'FACT', 'RULE', 'NOTE'];
const REPLACEABLE = new Set(['STATUS', 'DECISION', 'FACT', 'RULE', 'NOTE']);
const CLOSABLE = new Set(['TODO', 'FAILED']);
const SEP = ' · ';
const GEN_MARK = '<!-- generated from the Log by note-gen: do not edit by hand -->';
const LOG_BLURB = '> Dated entries, newest first. The only hand-written part: Now and Map are computed from it.';
// list caps keep the generated Now block within the 40-line limit (each capped list adds at most one "more" line)
const CAPS = { failed: 6, remaining: 8, done: 4, decisions: 3, facts: 5 };
const PREVIEW = 220;

const ENTRY_RE = /^- (e\d+) · (\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))? · ([A-Z]+) · (.*)$/;

function validDate(y, mo, d, h, mi) {
  const dt = new Date(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0);
  const ok = dt.getFullYear() === +y && dt.getMonth() === +mo - 1 && dt.getDate() === +d && (!h || (+h < 24 && +mi < 60));
  return ok ? dt : null;
}

function splitTail(rest) {
  const parts = rest.split(SEP);
  const out = { text: [], closes: [], replaces: [], src: '' };
  for (const part of parts) {
    let m;
    if ((m = /^closes (e\d+(?:,\s*e\d+)*)$/.exec(part))) out.closes.push(...m[1].split(/,\s*/));
    else if ((m = /^replaces (e\d+(?:,\s*e\d+)*)$/.exec(part))) out.replaces.push(...m[1].split(/,\s*/));
    else if ((m = /^src: (.+)$/.exec(part))) out.src = m[1].trim();
    else out.text.push(part);
  }
  return { ...out, text: out.text.join(SEP).trim() };
}

function parseLog(text) {
  const p = parse(text);
  const sec = p.sections.find((s) => s.key === 'log');
  const res = { has: !!sec, entries: [], errors: [], warnings: [], p, sec };
  if (!sec) return res;
  const seen = new Map();
  sec.body.slice(1).forEach((l, i) => {
    const t = l.trim();
    if (!t || t.startsWith('> ') || t.startsWith('<!--')) return;
    const lineNo = sec.start + 2 + i;
    const m = ENTRY_RE.exec(t);
    if (!m) { res.errors.push(`Log line ${lineNo} is not an entry ("- eN · YYYY-MM-DD HH:MM · TAG · text"): ${t.slice(0, 60)}`); return; }
    const [, id, y, mo, d, h, mi, tag, rest] = m;
    const when = validDate(y, mo, d, h, mi);
    if (!when) res.errors.push(`Log line ${lineNo}: invalid date ${y}-${mo}-${d}${h ? ` ${h}:${mi}` : ''}`);
    if (!TAGS.includes(tag)) res.errors.push(`Log line ${lineNo}: unknown tag ${tag} (use ${TAGS.join(', ')})`);
    if (seen.has(id)) res.errors.push(`Log line ${lineNo}: duplicate id ${id}`);
    const tail = splitTail(rest);
    if (!tail.text) res.errors.push(`Log line ${lineNo}: entry ${id} has no text`);
    const e = { id, n: +id.slice(1), date: `${y}-${mo}-${d}${h ? ` ${h}:${mi}` : ''}`, when, tag, ...tail, line: lineNo };
    seen.set(id, e);
    res.entries.push(e);
  });
  for (const e of res.entries) {
    for (const ref of e.closes) {
      const t = seen.get(ref);
      if (!t) res.errors.push(`${e.id} closes ${ref}, which does not exist`);
      else if (!CLOSABLE.has(t.tag)) res.errors.push(`${e.id} closes ${ref}, a ${t.tag}: only TODO or FAILED entries can be closed`);
      else if (t.n >= e.n) res.errors.push(`${e.id} closes ${ref}, which is not older`);
    }
    for (const ref of e.replaces) {
      const t = seen.get(ref);
      if (!t) res.errors.push(`${e.id} replaces ${ref}, which does not exist`);
      else if (t.tag !== e.tag || !REPLACEABLE.has(e.tag)) res.errors.push(`${e.id} (${e.tag}) replaces ${ref} (${t.tag}): only a STATUS, DECISION, FACT, RULE or NOTE can replace one of the same tag`);
      else if (t.n >= e.n) res.errors.push(`${e.id} replaces ${ref}, which is not older`);
    }
  }
  for (let i = 1; i < res.entries.length; i++) {
    if (res.entries[i].n > res.entries[i - 1].n) { res.warnings.push('Log is not newest-first (entry ids should go down the page)'); break; }
  }
  return res;
}

const short = (date) => date.slice(5, 10).replace('-', '/');
const preview = (e) => (e.text.length > PREVIEW ? `${e.text.slice(0, PREVIEW)}…(${e.text.length - PREVIEW} more characters, see ${e.id})` : e.text);

function capped(list, cap, fmt) {
  const shown = list.slice(0, cap).map(fmt);
  if (list.length > cap) shown.push(`- …(${list.length - cap} more in the Log)`);
  return shown.length ? shown : ['- none'];
}

// Computes the Now block lines from the Log entries. Pure function of the entries.
function computeNow(entries) {
  const closed = new Set(entries.flatMap((e) => e.closes));
  const replaced = new Set(entries.flatMap((e) => e.replaces));
  const newest = [...entries].sort((a, b) => b.n - a.n);
  const live = (tag) => newest.filter((e) => e.tag === tag && !replaced.has(e.id));
  const status = live('STATUS')[0];
  const last = newest[0];
  const failed = newest.filter((e) => e.tag === 'FAILED' && !closed.has(e.id));
  const remaining = entries.filter((e) => e.tag === 'TODO' && !closed.has(e.id)).sort((a, b) => a.n - b.n);
  const done = newest.filter((e) => e.tag === 'DONE' || e.tag === 'FIXED');
  const decisions = live('DECISION');
  const facts = [...live('RULE'), ...live('FACT')];
  let n = 0;
  return [
    '## Now',
    GEN_MARK,
    `**Status:** ${status ? preview(status) : '(no STATUS entry yet)'}`,
    `**Last verified:** ${last ? `${last.date} (newest Log entry ${last.id})` : '(no entries yet)'}`,
    '**Failed or stuck**',
    ...capped(failed, CAPS.failed, (e) => `- ${preview(e)} (${e.id}, ${short(e.date)})`),
    '**Remaining** (in order)',
    ...capped(remaining, CAPS.remaining, (e) => `${++n}. ${preview(e)} (${e.id})`),
    '**Done** (latest)',
    ...capped(done, CAPS.done, (e) => `- ${preview(e)} (${e.id}, ${short(e.date)})`),
    '**Decisions** (latest)',
    ...capped(decisions, CAPS.decisions, (e) => `- ${preview(e)} (${e.id}, ${short(e.date)})`),
    '**Key facts**',
    ...capped(facts, CAPS.facts, (e) => `- ${e.tag === 'RULE' ? 'RULE: ' : ''}${preview(e)} (${e.id})`),
  ];
}

function sectionRange(p, key) {
  const i = p.sections.findIndex((s) => s.key === key);
  if (i < 0) return null;
  return { from: p.sections[i].start, to: p.sections[i + 1] ? p.sections[i + 1].start : p.lines.length };
}

// Body fingerprint: a short hash of everything except the generated Now and Map and the frontmatter.
// addEntry stamps it into the Now block; if the body changes by hand later, the stamp no longer matches
// and readers are warned that Now may be out of date. note-gen keeps the old stamp on purpose.
// The stamp sits on the same line as the generated-marker comment, so Now does not grow by a line.
const STAMP_RE = /<!-- body: ([0-9a-f]{12}) -->/;
function bodyHash(text) {
  const p = parse(text);
  const skip = new Set();
  for (const s of p.sections) if (s.key === 'now' || s.key === 'map') for (let i = s.start; i < s.end; i++) skip.add(i);
  // blank lines and trailing spaces are ignored: only real text counts as an edit
  const body = p.lines.filter((l, i) => i >= p.bodyStart && !skip.has(i)).map((l) => l.replace(/\s+$/, '')).filter(Boolean).join('\n');
  return require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 12);
}
const stampIn = (lines) => { for (const l of lines) { const m = STAMP_RE.exec(l); if (m) return m[1]; } return null; };
// { stamped, edited }: edited = the body changed by hand after the newest Log entry (false when the note has no stamp yet)
function handEdited(text) {
  const log = parseLog(text);
  if (!log.has) return { stamped: false, edited: false };
  const now = log.p.sections.find((s) => s.key === 'now');
  const stamp = now ? stampIn(log.p.lines.slice(now.start, now.end)) : null;
  if (!stamp) return { stamped: false, edited: false };
  return { stamped: true, edited: stamp !== bodyHash(text) };
}

// Returns the note with Now regenerated from the Log (if it has one) and a fresh Map. Idempotent.
// { restamp: true } records the current body fingerprint (addEntry and one-off adoption); otherwise the old stamp is kept.
function withGenerated(text, { restamp = false } = {}) {
  const log = parseLog(text);
  if (!log.has) return parse(text).sections.some((s) => s.key === 'now') ? withMap(text) : text;
  const p = log.p;
  const lines = p.lines.slice();
  const nowLines = [...computeNow(log.entries), ''];
  const r = sectionRange(p, 'now');
  let stamp = null;
  if (restamp) stamp = bodyHash(text);
  else if (r) stamp = stampIn(lines.slice(r.from, r.to));
  if (stamp) { const at = nowLines.findIndex((l) => l === GEN_MARK); if (at >= 0) nowLines[at] = `${GEN_MARK} <!-- body: ${stamp} -->`; }
  if (r) lines.splice(r.from, r.to - r.from, ...nowLines);
  else {
    const at = p.sections.length ? p.sections[0].start : lines.length;
    lines.splice(at, 0, ...nowLines);
  }
  return withMap(lines.join(p.eol));
}

function secretIn(s) {
  for (const [name, re] of Object.entries(PATTERNS)) if (new RegExp(re.source, re.flags.replace('g', '')).test(s)) return name;
  return null;
}
const wordSet = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) || []);
function similar(a, b) {
  const A = wordSet(a); const B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
function stamp(d) {
  const z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

// Adds one entry (newest first), then regenerates Now and Map. Never changes the text when there is an error.
function addEntry(text, { tag, text: body, closes = [], replaces = [], src = '', date = new Date() }) {
  const errors = [];
  const warnings = [];
  tag = String(tag || '').toUpperCase();
  body = String(body || '').replace(/\s*\r?\n\s*/g, ' ').split(SEP).join(' - ').trim();
  src = String(src || '').split(SEP).join(' - ').trim();
  if (!TAGS.includes(tag)) errors.push(`unknown tag "${tag}" (use ${TAGS.join(', ')})`);
  if (!body) errors.push('the entry has no text');
  const leak = secretIn(body + ' ' + src);
  if (leak) errors.push(`refused: the text looks like a secret (${leak}). Never store secrets in memory; say where it lives instead.`);
  const log = parseLog(text);
  if (log.errors.length) errors.push(...log.errors.map((e) => 'the note already has a Log problem: ' + e));
  const byId = new Map(log.entries.map((e) => [e.id, e]));
  for (const ref of closes) {
    const t = byId.get(ref);
    if (!t) errors.push(`closes ${ref}: no such entry`);
    else if (!CLOSABLE.has(t.tag)) errors.push(`closes ${ref}: it is a ${t.tag}, only TODO or FAILED can be closed`);
  }
  for (const ref of replaces) {
    const t = byId.get(ref);
    if (!t) errors.push(`replaces ${ref}: no such entry`);
    else if (t.tag !== tag || !REPLACEABLE.has(tag)) errors.push(`replaces ${ref}: it is a ${t.tag}, a ${tag} can only replace the same tag (STATUS, DECISION, FACT, RULE, NOTE)`);
  }
  if (errors.length) return { ok: false, text, errors, warnings };

  if (tag === 'DECISION' && !/\b(because|since|so that|so |reason|why|due to|to avoid|instead of)\b|->|→/i.test(body)) warnings.push('a DECISION should say why (e.g. "... because ...")');
  const dup = log.entries.find((e) => e.tag === tag && similar(e.text, body) >= 0.8);
  if (dup) warnings.push(`looks like a near-duplicate of ${dup.id}: "${dup.text.slice(0, 60)}"`);
  if (body.length > 400) warnings.push('long entry: keep entries short and put detail in a section, then mention the section');

  const id = 'e' + (log.entries.reduce((m, e) => Math.max(m, e.n), 0) + 1);
  const line = ['- ' + id, stamp(date), tag, body, closes.length ? 'closes ' + closes.join(', ') : '', replaces.length ? 'replaces ' + replaces.join(', ') : '', src ? 'src: ' + src : '']
    .filter(Boolean).join(SEP);

  let p = log.p;
  let lines = p.lines.slice();
  if (!log.has) { // create the Log right after Now/Map (or at the top of the body)
    const after = p.sections.filter((s) => s.key === 'now' || s.key === 'map');
    const firstOther = p.sections.find((s) => s.key !== 'now' && s.key !== 'map');
    const at = firstOther ? firstOther.start : (after.length ? lines.length : (p.sections[0] ? p.sections[0].start : lines.length));
    lines.splice(at, 0, '## Log', LOG_BLURB, '', '');
    p = parse(lines.join(p.eol));
    lines = p.lines.slice();
  }
  const sec = p.sections.find((s) => s.key === 'log');
  let at = sec.start + 1;
  while (at < sec.end && (lines[at].trim().startsWith('> ') || lines[at].trim().startsWith('<!--'))) at++;
  lines.splice(at, 0, line);
  const out = withGenerated(lines.join(p.eol), { restamp: true });
  return { ok: true, text: out, entry: { id, tag, text: body, closes, replaces, src, line }, errors, warnings };
}

// Full check of a note: the layout rules plus the Log rules, and the generated parts must be current.
function validateNote(text) {
  const base = validate(text);
  const log = parseLog(text);
  if (!log.has) return base;
  const errors = base.errors.filter((e) => !/Map is out of date/.test(e));
  errors.push(...log.errors);
  if (!log.errors.length && withGenerated(text).replace(/\s+$/, '') !== text.replace(/\s+$/, '')) errors.push('Now or Map is out of date with the Log (run: note-gen --write)');
  const warnings = [...base.warnings, ...log.warnings];
  const h = handEdited(text);
  if (h.edited) warnings.push('edited by hand after the newest Log entry: Now may be out of date (add a Log entry with memory_add)');
  return { ...base, errors, warnings, entries: log.entries.length };
}

module.exports = { TAGS, GEN_MARK, LOG_BLURB, parseLog, computeNow, withGenerated, addEntry, validateNote, stamp, bodyHash, handEdited };
