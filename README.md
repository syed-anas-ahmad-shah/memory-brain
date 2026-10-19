# Memory Brain

A memory for Claude Code that you can see working, search by any wording, and that is backed up to git.

In one sentence: your notes live in one folder, Claude searches them before it answers, writes down what fails or gets decided, and a badge at the start of every chat tells you the memory is healthy.

## What you get

| Part | What it does | Plain words |
|---|---|---|
| Badge | One line at the start of each new chat: notes count, stale notes, last backup, problems | A dashboard light for your memory |
| 4 search tools | `memory_index`, `memory_search`, `memory_read`, `memory_add` | A librarian Claude can ask |
| Layered notes | Each project note has a short **Now** block, a generated **Map**, a dated **Log** and an **Archive** | Skim the top, go deeper only when needed |
| Save reminder | After a reply that edited 3+ files but logged nothing, Claude is asked once to log it (at most once per 30 min per chat) | A gentle nudge, not a nag |
| Backup | Commits and pushes the memory folder to any git address, in the background | Your notes survive a dead disk |
| Secret guard | Blocks commits and pushes that contain key-shaped text | Keys never reach the backup |
| Health check | Finds duplicates, broken links and secrets | Tidy notes |
| `/memory-brain:setup` | Walks you through first-time setup, one question at a time, and can undo itself | Nothing changes without your yes |
| `/memory-brain:convert` | Turns older prose notes into layered notes, previews each one, proves no line is lost, backs up first | Bring your old notes along safely |

## Install

1. Add this repository as a marketplace: `/plugin marketplace add syed-anas-ahmad-shah/memory-brain` (or a local folder path)
2. Install it: `/plugin install memory-brain@memory-brain-market`
3. Start a new chat and run `/memory-brain:setup`. It looks first, asks what it needs, and changes nothing until you answer.

Needs: Node 18+ and git. The GitHub CLI (`gh`) is optional.

## Settings

Set in the plugin options (saved in your Claude settings, never in the notes folder).

| Option | Meaning |
|---|---|
| `brain_dir` | Your memory folder (where `MEMORY.md` lives) |
| `backup_remote` | Git address to push backups to. Empty = commit on this computer only. A name like `origin` also works |
| `gh_account` | Optional. Push with this GitHub CLI login instead of git's saved account. Needed when you are logged into two GitHub accounts |
| `commit_name`, `commit_email` | Optional author on backup commits, for example a noreply address |
| `stale_days` | Days before a project note counts as stale (default 30) |

## How a question gets answered

1. You ask something about past work.
2. Claude calls `memory_search` and gets the best notes, with a short snippet each.
3. It calls `memory_read` on the right note. By default that returns only the Now block and the Map, not the whole file.
4. If the notes do not state the answer, Claude says "not recorded" instead of guessing.

To make Claude do this in every chat, add a short rule to your `CLAUDE.md`. See [GUIDE.md](GUIDE.md).

## Safety

- Nothing on your computer changes without a yes. Setup backs up your settings and `CLAUDE.md` first, and `node setup.js undo` puts them back. Your notes are never touched by undo.
- Real secrets are refused by `memory_add`, blocked by the git guards and caught by the scan before every backup.
- Old text is never deleted. Converted notes keep their original text under `## Archive`.

## Limits

- Tested on Windows and on Linux (Ubuntu 24.04 under WSL, Node 22): every test suite passes on both. Mac is plain Node too but has not been run.
- The search finds the right note in the top 3 on about 92% of our 64 test questions (a plain index: 53%). That measures finding the note, not whether the final answer is right.
- Real answers: in a 14-question run with a small model (Haiku) and an automatic grader, 9 were fully correct, 4 partly correct and 1 judged wrong, and Claude used the memory tools every time. A small sample, not a benchmark.
- The reminder and the rule only help if Claude follows them. Check the badge and read what it logs.

## Files

| Path | What |
|---|---|
| `plugins/memory-brain/` | The plugin: hooks, scripts, tools, setup skill, tests |
| `plugins/memory-brain/NOTE-FORMAT.md` | The note format in detail |
| `GUIDE.md` | Day-to-day use |
| `CHANGELOG.md` | What changed in each version |

Run the tests with `node plugins/memory-brain/tests/run.js`, plus the other files in `tests/`.

## Not affiliated

Memory Brain is an independent, community-made plugin **for** Claude Code. It is not made, endorsed or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC, are used here only to say what this plugin works with, and are not covered by this project's licence.

MIT licence.
