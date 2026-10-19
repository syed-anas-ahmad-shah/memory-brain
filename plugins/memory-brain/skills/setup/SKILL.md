---
name: setup
description: Set up Memory Brain - create or adopt the memory folder and its git repo, bring in existing Claude memory notes, choose a backup address, and (only with a yes) point Claude's auto memory at the folder and add the save rule to CLAUDE.md. Use when the user runs /memory-brain:setup or the memory badge says "not set up".
disable-model-invocation: true
---

# Memory Brain setup

You are setting up the user's memory on this computer. The user may not be technical: plain words, short tables, define any technical term the first time. **Nothing changes on their computer until they have answered the questions below.** Every settings change is backed up and can be undone.

The worker script is `${CLAUDE_PLUGIN_ROOT}/scripts/setup.js`. Run it with `node "<that path>" ...` (works in Bash and PowerShell).

## 1. Look first (changes nothing)

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" plan` and read the JSON. Then tell the user in a short table what you found: the suggested memory folder and whether it already exists / has notes, git status (`repo.kind`: `none` = no backup repo yet, `own` = its own repo, `parent` = it sits inside another repo), existing Claude notes that could be brought in (`import_candidates`), and whether `autoMemoryDirectory` and the CLAUDE.md rule are already set.

Stop and explain if `settings` says INVALID JSON (they must fix that file first) or `git` is false (they must install git first).

## 2. Ask, all at once, with your recommendation first

Use AskUserQuestion (or a short numbered list). Ask only what applies:

| Question | Options (recommended first) |
|---|---|
| Memory folder | the `suggested_brain` path (Recommended) · another folder (they type it) |
| Bring in existing notes? (only if `import_candidates` is not empty; multiSelect) | each candidate folder with its note count · none. Explain: notes are copied, never moved; a note whose name already exists is skipped |
| Backup | Local only for now (Recommended if they have no private repo) · I have a private git address (they paste it) · Create a private GitHub repo for me (only if `gh` is true: you run `gh repo create <name> --private` after this answer, then use its URL) |
| Let new chats save memory into this folder? | Yes (Recommended) - sets `autoMemoryDirectory` in their Claude settings · No |
| Add the "save memory without being asked" rule to CLAUDE.md? | Yes (Recommended) - adds a short marked block to `~/.claude/CLAUDE.md` · No |

Only if `repo.kind` is `parent`: also ask whether that repo holds nothing but memory. If not, recommend a different folder; backups would commit everything in that repo. Only if they back up to GitHub and have several gh accounts: ask which account to push as, and the commit name/email to use.

## 3. Do it

Build one command from the answers and run it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" apply --brain "<folder>" [--import "<dir>"]... [--remote "<url>"] [--first-backup] [--auto-memory] [--claude-md] [--use-parent-repo] [--gh-account <acct> --commit-name "<name>" --commit-email "<email>"]
```

- `--first-backup` only when a backup address was given (it pushes once and confirms the copy arrived).
- If the script prints `SETUP STOPPED`, nothing was changed: explain the reason in one plain sentence and how to fix it.
- If it prints `COMMIT BLOCKED`, `FIRST BACKUP FAILED` or `HEALTH CHECK:` with problems, say exactly what is wrong; never hide it.

## 4. Hand over

Show a short table of what changed (from the script's lines), then:
- "Start a new chat to see the memory badge (🧠 Memory OK ...)."
- The undo: `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" undo` puts settings and CLAUDE.md back; the notes stay.
- The settings can be changed later in `/config` (Memory Brain section).
