# Memory Brain: day-to-day guide

In one sentence: you mostly do nothing; Claude searches and logs by itself, and you glance at the badge.

## 1. Reading the badge

The first reply of each new chat starts with one line, for example:

`Memory OK · saved 12 h ago · backup ok (10-19 08:07) · 114 live notes · 3 stale`

| Part | Meaning | If it looks wrong |
|---|---|---|
| `Memory OK` / `Memory !` | Health check result. `!` comes with a sentence saying what is wrong | Read the sentence and fix that one thing |
| `saved N h ago` | When a note last changed | Very old = nothing is being saved |
| `backup ok (date)` | Last good push to your git address | `backup not run yet` right after install is normal. A failed backup says why |
| `N live notes` | Notes outside the archive | |
| `N stale` | Project notes not edited for `stale_days` | Review or archive them |
| `N note(s) saved outside the brain` | Notes written to the old default memory folder | Copy them into your memory folder by hand (it never copies for you) |

Two badge lines in one chat means an old hook is still active next to the plugin. Remove the old one from your Claude settings.

## 2. The four tools

| Tool | Use it for | You say |
|---|---|---|
| `memory_search` | Finding the right note by any wording, typos included | "Where are we on the launch film?" |
| `memory_read` | Reading one note: summary first, then a section, then full entries | (Claude does this after a search) |
| `memory_add` | Writing one dated entry to a note's Log | "Log that the deploy failed because of X" |
| `memory_index` | Listing every project; with `open: true`, every open FAILED and TODO across all projects (the "what is happening / what are we waiting on" view) | "What projects do I have?" / "What is open?" |

Entry tags: STATUS, DONE, DECISION (needs a reason), FAILED, FIXED, TODO, FACT, RULE, NOTE. `closes e12` marks an older item finished. `replaces e12` retires an old fact.

## 3. The rule that makes Claude use the tools

Add this to your global `CLAUDE.md` (adapt the wording):

> - Before answering about past work, a decision or a project's status, call `memory_search`, then `memory_read`. If the notes do not state the answer, say "not recorded". Do not guess.
> - Any question about my own projects, products, prices, accounts, tools, setup or past decisions is a memory question: search FIRST, even if you think you know the answer. Only pure general-knowledge questions skip memory.
> - For "what is happening / what is open / what are we waiting on" call `memory_index` with `open: true`. If `memory_read` shows a WARNING that the note was edited by hand, read the sections it lists.
> - When something fails, a decision is made (with its reason) or a task finishes, call `memory_add` with a tag; use `closes eN` when it finishes an item.
> - A note with a `## Log` is changed only with `memory_add`. Never hand-edit its Now, Map or text.

Without this rule the tools exist but Claude only uses them when asked.

## 4. Writing and converting notes

- One project = one note, with `name`, `description`, `aliases` (the words you would use to ask: "film", "recording", "video") and `folders` (where the work happens, so the right project ranks first).
- You write only the **Log**. `Now`, `Map` and the index are generated. Never edit them by hand.
- Check notes: `node scripts/note-check.js <file or folder> --strict`. Regenerate: `node scripts/note-gen.js <file> --write`.
- Convert an old note: put its history into the Log as entries and keep the old text under `## Archive`. Every original line must survive.

### Converting older notes

Run `/memory-brain:convert`. It lists your older notes (biggest first), asks which to convert (project notes over about 500 tokens gain the most), and for each one:

1. Claude reads the note and writes a small spec: the words you would use to ask about it (aliases), the folders the work lives in, and short dated entries (FAILED, FIXED, DECISION, TODO, STATUS...) that are written in the note. It never invents facts.
2. A preview shows the new Now summary and the check "0 original lines lost". Nothing is written yet.
3. After your yes, the old note is copied to `<memory folder>/.convert-backup/` and the layered note is written. To undo, copy the backup back.

Command line: `node scripts/note-convert.js --list`, then `node scripts/note-convert.js <note> <spec.json> [--apply]`.

### Hand edits are caught

`memory_add` stamps a short fingerprint of the note's text into the Now block. If someone edits the note by hand afterwards, the fingerprint no longer matches, and:

- `memory_read` starts with `WARNING: this note was edited by hand after its newest Log entry` and lists the sections to read;
- `memory_search` marks the hit `(EDITED BY HAND ...)`;
- `note-check` prints a warning (not an error; hand edits stay allowed).

The warning goes away when you add the next Log entry (`memory_add`). `note-gen --write` does not clear it, on purpose. Notes converted before 0.2.1 are stamped once by adopting their current text.

## 5. Backups

- Run on session start in the background, and any time with `node scripts/backup.js`.
- Order: secret scan, health check, commit, push, then it **verifies** the remote has the same commit. It prints `pushed and verified` only if so.
- Two GitHub accounts on one PC? Set `gh_account`, or pushes go as the wrong one and fail with "repository not found".

## 6. The save reminder

The hook counts file edits and shell commands in the whole chat since the last `memory_add` (or note written directly in the memory folder). At 4 or more, Claude gets one reminder to call `memory_add`. It fires at most once per 10 minutes per chat and never loops. Reads and searches do not count. To switch it off, remove its entry from `hooks/hooks.json`.

## 7. Undo and restore

| Need | Command |
|---|---|
| Put settings and `CLAUDE.md` back as before setup | `node scripts/setup.js undo` |
| Rebuild the notes from the backup into an EMPTY folder and prove it matches | `node scripts/restore.js --target <empty folder>` (optional `--source`, `--compare-with`) |

## 8. When something is off

| Symptom | Likely cause |
|---|---|
| Tools missing in a new chat | Plugin not enabled, or Claude not restarted since install |
| `backup not run yet` for days | `backup_remote` empty, or `gh_account` missing |
| Search answers with a wrong note | Add `aliases` with the words you used |
| Claude guesses instead of "not recorded" | The `CLAUDE.md` rule is missing |
