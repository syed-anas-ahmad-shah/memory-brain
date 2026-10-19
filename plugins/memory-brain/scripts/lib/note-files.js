'use strict';
// Finds note files in a folder for the note-map / note-check commands.
const fs = require('fs');
const path = require('path');

const SKIP_FILES = /^(MEMORY|STATE|CATALOG|README|GUIDE|CHANGELOG)\.md$/i;
const SKIP_DIRS = new Set(['archive', 'log', 'node_modules', '.git', 'evals']);

function collect(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (e.name.endsWith('.md') && !SKIP_FILES.test(e.name)) out.push(p);
    }
  })(target);
  return out;
}

module.exports = { collect };
