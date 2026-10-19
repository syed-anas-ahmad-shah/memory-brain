'use strict';
// Ranked search over every note in the brain, with no separate index to drift: the corpus is rebuilt from the files
// whenever one changes. Field-weighted BM25 (titles, aliases, descriptions and headings count more than body text),
// typo tolerance, adjacent-word bonus, and an honest confidence so "not recorded" is possible.
const fs = require('fs');
const path = require('path');
const { parse } = require('./note-format');
const { parseLog, handEdited } = require('./note-log');
const { fmList } = require('./note-index');

const STOP = new Set(('a an the is are was were be been being of to in on for and or with what which who whom when where why how do does did done i we my our me you your it its this that these those there here should can could would will at by from as about into not no yes so if then than too very just also any all some more most like want need get got make made please tell give show find know thing things stuff go going goes much many').split(/\s+/));
const WEIGHTS = { title: 5, aliases: 5, desc: 3, head: 2.5, top: 2, log: 2, rest: 1, arch: 0.5 };
const K1 = 1.4;
const B = 0.75;
const SKIP_DIRS = new Set(['log', '.git', 'node_modules', 'evals', 'full']); // 'full' = archive/full duplicates of live notes
const SKIP_FILES = /^(MEMORY|CATALOG|STATE)\.md$/; // STATE.md: retired page (before 0.3.0), never searched
const RECENT_MS = 7 * 24 * 3600e3;

const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9$][a-z0-9._$-]*[a-z0-9]|[a-z0-9]/g) || []);
function stem(w) {
  if (w.length <= 3) return w;
  let o = w;
  if (/ies$/.test(o) && o.length > 4) o = o.replace(/ies$/, 'y');
  else if (/(ing|ed)$/.test(o) && o.length > 5) { o = o.replace(/(ing|ed)$/, ''); if (/([^aeiou])\1$/.test(o) && !/(ss|ll|ff|zz)$/.test(o)) o = o.slice(0, -1); }
  else if (/es$/.test(o) && o.length > 4) o = o.replace(/es$/, '');
  else if (/s$/.test(o) && !/ss$/.test(o) && o.length > 3) o = o.replace(/s$/, '');
  if (o.length > 4 && /e$/.test(o)) o = o.slice(0, -1); // price and pricing meet at "pric"
  return o;
}
const terms = (s) => tokenize(s).filter((w) => !STOP.has(w)).map(stem);

function walk(brain) {
  const out = [];
  (function rec(d) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) rec(p); }
      else if (e.name.endsWith('.md') && !SKIP_FILES.test(e.name)) out.push(p);
    }
  })(brain);
  return out;
}

const fmOne = (fm, key) => { const m = new RegExp('^\\s*' + key + ':\\s*(.*)$', 'm').exec(fm || ''); return m ? m[1].replace(/^["']|["']$/g, '').trim() : ''; };

function makeDoc(brain, file) {
  const text = fs.readFileSync(file, 'utf8');
  const st = fs.statSync(file);
  const rel = path.relative(brain, file).replace(/\\/g, '/');
  const p = parse(text);
  const log = parseLog(text);
  const bodyText = p.lines.slice(p.bodyStart).join('\n');
  const sec = (k) => p.sections.filter((s) => s.key === k).map((s) => s.body.join('\n')).join('\n');
  const now = sec('now');
  const logText = sec('log');
  const archive = sec('archive');
  let top = now;
  let arch = archive;
  let rest;
  if (now || logText || archive) {
    rest = p.sections.filter((s) => !['now', 'map', 'log', 'archive'].includes(s.key)).map((s) => s.body.join('\n')).join('\n');
  } else { // older note: top = first lines; a restored note's "Full detail" is archive
    const mark = bodyText.indexOf('## Full detail (restored');
    const before = mark >= 0 ? bodyText.slice(0, mark) : bodyText;
    arch = mark >= 0 ? bodyText.slice(mark) : '';
    top = before.split('\n').slice(0, 60).join('\n');
    rest = before;
  }
  const name = fmOne(p.fm, 'name') || path.basename(file, '.md');
  const desc = fmOne(p.fm, 'description');
  const aliases = fmList(p.fm, 'aliases');
  const base = path.basename(file, '.md').replace(/[_-]+/g, ' ');
  const fields = {
    title: `${name} ${base}`,
    aliases: aliases.join(' '),
    desc,
    head: p.sections.map((s) => s.title).join(' '),
    top, log: logText, rest, arch,
  };
  const tf = new Map();
  let len = 0;
  for (const [f, t] of Object.entries(fields)) {
    const w = WEIGHTS[f];
    for (const term of terms(t)) { tf.set(term, (tf.get(term) || 0) + w); len += w; }
  }
  return {
    rel, file, name, desc, aliases, mtime: st.mtimeMs, text, p, log, tf, len: len || 1,
    isArchive: rel.startsWith('archive/'), isOther: rel.startsWith('archive/other/'),
    headStr: `${fields.title} ${fields.aliases} ${fields.desc} ${fields.head}`.toLowerCase(),
  };
}

const cache = new Map();
function corpus(brain) {
  const files = walk(brain);
  const sig = files.map((f) => { try { const s = fs.statSync(f); return `${f}:${s.mtimeMs}:${s.size}`; } catch { return f; } }).join('|');
  const hit = cache.get(brain);
  if (hit && hit.sig === sig) return hit.value;
  const docs = files.map((f) => { try { return makeDoc(brain, f); } catch { return null; } }).filter(Boolean);
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const value = { docs, df, N: docs.length, avg: docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length), vocab: [...df.keys()] };
  cache.set(brain, { sig, value });
  return value;
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// query -> [{ raw, variants: [{ term, w }], matched }], where unknown words fall back to near spellings or prefixes
function plan(c, query) {
  const raws = tokenize(query).filter((w) => !STOP.has(w));
  return raws.map((raw) => {
    const t = stem(raw);
    if (c.df.has(t)) return { raw, variants: [{ term: t, w: 1 }] };
    const max = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
    const cands = [];
    for (const v of c.vocab) {
      if (t.length >= 4 && v.length > t.length && v.startsWith(t)) { cands.push({ term: v, w: 0.65, d: 0.5 }); continue; }
      if (v.length >= 4 && t.length > v.length && t.length - v.length <= 3 && t.startsWith(v)) { cands.push({ term: v, w: 0.6, d: 0.6 }); continue; } // typo inside a word ending: "pricng" -> "pric"
      if (max && v.length >= 3) { const d = editDistance(t, v, max); if (d <= max) cands.push({ term: v, w: d === 1 ? 0.7 : 0.55, d }); }
    }
    cands.sort((a, b) => a.d - b.d || c.df.get(b.term) - c.df.get(a.term));
    return { raw, variants: cands.slice(0, 3).map(({ term, w }) => ({ term, w })) };
  });
}

// Best single line (a text line, the description, or a Log entry): the one holding the most query words.
// Returns the line plus lineCov = idf-weighted share of the query words found TOGETHER in that one line, which is what
// separates "the answer is written down" from "the words appear somewhere in the same note".
function bestLine(doc, pl, idfOf, idfMax) {
  const denom = pl.reduce((a, q) => a + (q.variants.length ? Math.max(...q.variants.map((v) => idfOf(v.term))) : idfMax), 0) || 1;
  const cover = (text) => {
    const ts = new Set(terms(text));
    let c = 0;
    for (const q of pl) {
      let b = 0;
      for (const v of q.variants) if (ts.has(v.term)) b = Math.max(b, v.w * idfOf(v.term));
      c += b;
    }
    return c / denom;
  };
  let best = ''; let bestC = 0;
  const consider = (t) => {
    const c = cover(t);
    if (c > bestC + 1e-9 || (Math.abs(c - bestC) < 1e-9 && c > 0 && t.length < best.length)) { best = t; bestC = c; }
  };
  consider(`${doc.name} ${doc.aliases.join(' ')}`);
  if (doc.desc) consider(doc.desc);
  for (const l of doc.text.split(/\r?\n/)) {
    const t = l.trim();
    if (!t || /^(---|#|\||<!--)/.test(t) || /^(name|description|metadata|type|status|node_type|originSessionId|modified):/.test(t)) continue;
    consider(t);
  }
  return { line: best.replace(/^[-*>\d.\s]+/, '').slice(0, 150), lineCov: Math.round(bestC * 100) / 100 };
}

// Options: limit (5), tags ([...]), since (date string), project (name filter). Returns { confident, coverage, hits }.
function search(brain, query, opts = {}) {
  const limit = opts.limit || 5;
  const c = corpus(brain);
  const pl = plan(c, query);
  const tags = (opts.tags || []).map((t) => String(t).toUpperCase());
  const since = opts.since ? new Date(opts.since) : null;
  const sinceMs = since && !isNaN(since) ? since.getTime() : null;
  const filtered = tags.length || sinceMs !== null;
  const idfOf = (t) => Math.log(1 + (c.N - (c.df.get(t) || 0) + 0.5) / ((c.df.get(t) || 0) + 0.5));
  const idfMax = Math.log(1 + c.N);
  const matchTerms = pl.flatMap((q) => q.variants.map((v) => v.term));
  const denom = pl.reduce((a, q) => a + (q.variants.length ? Math.max(...q.variants.map((v) => idfOf(v.term))) : idfMax), 0) || 1;
  const pairs = [];
  for (let i = 0; i + 1 < pl.length; i++) pairs.push([pl[i].raw, pl[i + 1].raw]);

  const hits = [];
  for (const d of c.docs) {
    if (opts.project && !`${d.name} ${d.rel} ${d.aliases.join(' ')}`.toLowerCase().includes(String(opts.project).toLowerCase())) continue;
    let entries = d.log.entries || [];
    if (filtered) {
      entries = entries.filter((e) => (!tags.length || tags.includes(e.tag)) && (sinceMs === null || (e.when && e.when.getTime() >= sinceMs)));
      if (!entries.length) continue;
    }
    let s = 0; let cov = 0;
    for (const q of pl) {
      let bestW = 0; let bestIdf = 0;
      for (const v of q.variants) {
        const f = d.tf.get(v.term) || 0;
        if (!f) continue;
        const idf = idfOf(v.term);
        s += v.w * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / c.avg));
        if (v.w > bestW) { bestW = v.w; bestIdf = idf; }
      }
      cov += bestW * bestIdf;
    }
    cov /= denom;
    if (!pl.length && !filtered) continue;
    // identity bonus: query words found in the note's own name, aliases or description say what the note IS about.
    // Weighted by rarity, so a word every note has ("project") adds nothing and a rare one ("cost") decides.
    if (pl.length && s > 0) {
      const idSet = new Set(terms(`${d.name} ${d.aliases.join(' ')} ${d.desc || ''}`));
      let idc = 0;
      for (const q of pl) { let b = 0; for (const v of q.variants) if (idSet.has(v.term)) b = Math.max(b, v.w * idfOf(v.term)); idc += b; }
      idc /= denom;
      s *= 1 + 1.5 * idc * idc;
    }
    for (const [a, b2] of pairs) if (d.headStr.includes(`${a} ${b2}`)) s += 0.6 * (idfOf(stem(a)) + idfOf(stem(b2)));
    s *= 0.5 + 0.5 * cov;
    if (d.isOther) s *= 0.5; else if (d.isArchive) s *= 0.6;
    if (Date.now() - d.mtime < RECENT_MS) s *= 1.08;
    if (!pl.length && filtered) s = (entries[0].when ? entries[0].when.getTime() : 0) / 1e12; // pure filter: newest first
    if (s <= 0) continue;
    const ms = new Set(matchTerms);
    const hitEntries = entries
      .map((e) => ({ e, n: new Set(terms(e.text).filter((x) => ms.has(x))).size }))
      .filter((x) => x.n > 0 || (filtered && !pl.length))
      .sort((a, b2) => b2.n - a.n || b2.e.n - a.e.n)
      .slice(0, 2)
      .map((x) => ({ id: x.e.id, tag: x.e.tag, date: x.e.date, text: x.e.text.length > 160 ? x.e.text.slice(0, 160) + '…' : x.e.text }));
    const bl = bestLine(d, pl, idfOf, idfMax);
    hits.push({ rel: d.rel, name: d.name, title: (d.desc || d.name).slice(0, 110), score: Math.round(s * 100) / 100, coverage: Math.round(cov * 100) / 100, snippet: bl.line, lineCov: bl.lineCov, entries: hitEntries, archive: d.isArchive, edited: !d.isArchive && handEdited(d.text).edited });
  }
  hits.sort((a, b2) => b2.score - a.score);
  const top = hits[0];
  return { confident: !!top && top.coverage >= 0.55 && top.lineCov >= 0.4, coverage: top ? top.coverage : 0, lineCoverage: top ? top.lineCov : 0, hits: hits.slice(0, limit) };
}

// Finds one note by exact/loose name first (name, file name, alias), then by search. Returns { doc } or { suggestions }.
function resolve(brain, ref) {
  const c = corpus(brain);
  const key = (s) => String(s).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '');
  const k = key(ref);
  if (!k) return { suggestions: [] };
  const exact = c.docs.filter((d) => [d.rel, d.name, path.basename(d.rel), ...d.aliases].some((x) => key(x) === k) || key(d.rel) === k);
  const live = exact.filter((d) => !d.isArchive);
  if (live.length || exact.length) return { doc: (live[0] || exact[0]) };
  // Not an exact name. Accept only an identifier (name, file name, alias) that clearly contains the reference, or is clearly
  // contained in it, and only when exactly one live note qualifies. Never guess from words in the note body: a wrong note is worse than none.
  const ids = (d) => [d.name, path.basename(d.rel, '.md'), ...d.aliases].map(key).filter((x) => x.length >= 4);
  const part = c.docs.filter((d) => !d.isArchive && ids(d).some((x) => (k.length >= 4 && x.includes(k)) || (x.length >= 6 && k.includes(x))));
  if (part.length === 1) return { doc: part[0] };
  const r = search(brain, String(ref), { limit: 4 });
  return { suggestions: (part.length ? part.map((d) => ({ rel: d.rel })) : r.hits).map((h) => h.rel) };
}

function allDocs(brain) { return corpus(brain).docs; }

module.exports = { search, resolve, allDocs, corpus, terms, tokenize, stem };
