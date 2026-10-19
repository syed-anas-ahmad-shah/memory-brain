# Changelog

## 0.4.0

- **`/memory-brain:convert`**: turns older prose notes into layered notes (Log + generated Now and Map) without losing a line. Claude writes a small spec from the note's own text; `scripts/note-convert.js` previews it (dry run), proves "0 original lines lost", backs the old note up to `.convert-backup/` and writes only after a yes. `--list` shows which notes are still old. Colliding headings (`## Now`, `## Map`, `## Log`, `## Archive`) are kept as `## Old ...`.
- **`memory_read` no longer guesses.** It used to fall back to a fuzzy body-word search and could silently return the wrong note (found in a real answer-quality run). Now only an exact or clearly-contained name/alias resolves; anything else returns the closest paths. It also accepts `path`/`note`/`file`/`name` for `project` and returns a clear error when none is given.
- **Better search.** An identity bonus ranks notes whose own name, aliases or description contain the rare query words (retrieval on our 64-question test: 86% -> 92% right note in the top 3); `much`/`many` are stop words.
- **Stronger rule.** The recommended `CLAUDE.md` rule (and the setup block) says any question about the user's own projects, prices, accounts, tools, setup or decisions is a memory question: search first even if you think you know. In a 14-question real run, memory use went from 12/14 to 14/14.
- **Backup no longer blocked by a new note.** Found on a fresh machine: the first new note left the generated `CATALOG.md` stale, the health check failed and the backup refused to run. The backup now refreshes the catalog first.
- Proven on a clean machine (empty config, real Claude, setup skill, add, recall, "not recorded", convert) and on Linux (WSL Ubuntu 24.04, Node 22: all suites pass). Mac is still untested.
- Tests: main 83, note-convert 27, memory-tools 67, note-log 60, note-format 28, save-reminder 18.

## 0.3.0

- **No more STATE.md.** The hand-kept "what is happening now" page is gone from the method: it was a second summary beside the notes and it went stale. Project status lives in each note's Log; `memory_index` is the cross-project view.
- `memory_index` takes `open: true`: every open FAILED and TODO entry across all projects (waiting, on hold, next steps), newest activity first, capped at 45 lines.
- The badge no longer checks a STATE.md review date; setup no longer creates STATE.md; the setup CLAUDE.md block now names the memory tools and the "change layered notes only with `memory_add`" rule. A leftover STATE.md is ignored by the badge, the note count and the search.
- Tests: main suite 81, memory-tools 58, note-log 60, note-format 28, save-reminder 18.

## 0.2.1

- **Hand-edit detection.** `memory_add` stamps a fingerprint of the note's text (not Now/Map) on the generated-marker line of the Now block. When the text changes by hand afterwards, `memory_read` shows a WARNING with the sections to read, `memory_search` marks the hit, and `note-check` warns. Found in a real chat: a note hand-edited by another chat gave a stale "where are we" answer.
- `note-gen` keeps the old stamp (it never hides a hand edit); a new Log entry clears it. Blank lines, trailing spaces and CRLF are not edits.
- Tests: note-log 60, memory-tools 52 (4 planted bugs caught).
- The recommended `CLAUDE.md` rule now says: check `STATE.md` for "latest" questions, and change layered notes only with `memory_add`.

## 0.2.0

- **Layered notes**: each project note has a generated Now block (max 40 lines), a generated Map, a dated Log and an Archive. Validator: `note-check.js --strict`.
- **Entry engine**: `note-add.js`, `note-gen.js`. Tags STATUS, DONE, FIXED, FAILED, TODO, DECISION, FACT, RULE, NOTE. `closes` and `replaces` links. Refuses secret shapes, flags near-duplicates and decisions without a reason.
- **Four search tools** over MCP: `memory_index`, `memory_search`, `memory_read`, `memory_add`. Search is field-weighted BM25 with typo tolerance, frontmatter `aliases` and `folders`, and archive demotion. Plain-text snippets and a "probably not recorded" signal.
- **Save reminder** (Stop hook): after a reply with 3+ edits and no log, asks Claude once to log it. Cooldown 30 minutes, never loops.
- **Git secret guards** are installed by the plugin (`install-git-hooks.js`) and no longer depend on PowerShell. Existing non-plugin hooks are never overwritten.
- Backups verify that the remote holds the same commit before reporting success.
- Tests: save-reminder 18, memory-tools 45, note-log 46, note-format 28, main suite 79.

## 0.1.0

- First version: badge on every new chat, Stop log, background git backup, secret scan, health check, catalog, restore, `/memory-brain:setup` with undo. All in Node, for Windows, Mac and Linux (Mac and Linux untested).
