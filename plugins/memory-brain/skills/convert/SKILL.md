---
name: convert
description: Convert older prose memory notes into Memory Brain's layered format (a dated Log, a generated Now summary and Map) without losing a single line. Shows a preview for each note and writes only after a yes.
disable-model-invocation: true
---

# Memory Brain convert

You are converting the user's older memory notes into the layered format, so a chat can read a short **Now** summary first and go deeper only when needed. The user may not be technical: plain words, short tables, define a term the first time. **Nothing is written until the user says yes to that note.** Every converted note keeps all of its original text, and the old version is backed up first.

The worker is `${CLAUDE_PLUGIN_ROOT}/scripts/note-convert.js`. Run it with `node "<that path>" ...` (works in Bash and PowerShell).

## 1. Look first (changes nothing)

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/note-convert.js" --list`. Tell the user in one short table how many notes are layered and how many are older. Recommend converting **project notes with more than about 500 tokens** first. Short rule or reference notes gain almost nothing, so skip them unless the user asks.

Ask which notes to convert (a short list, your recommendation first). Do 3 to 5 notes per round, not everything at once.

## 2. For each chosen note: write a spec from the note's own text

Read the note. Then write a JSON spec to a scratch file (not inside the memory folder):

```json
{
  "aliases": ["the words the user would say when asking about it", "synonyms", "short names"],
  "folders": ["absolute paths where the work for this project lives (optional)"],
  "entries": [
    { "k": "a", "d": "2026-03-01", "t": "09:00", "tag": "FAILED", "text": "one short sentence" },
    { "k": "b", "d": "2026-03-05", "tag": "FIXED", "text": "...", "closes": ["a"] }
  ]
}
```

Rules for the entries:

| Rule | Why |
|---|---|
| Only facts that are written in the note. Never invent or guess. | The Log becomes the source of truth. |
| Oldest first. Use the dates in the note; if it has none, use the date the note was last edited (the tool does this when `d` is missing). | The Now summary is built from the order. |
| Tags: STATUS (where it stands now, one only), DONE, FIXED, FAILED, TODO, DECISION (give the reason: "because ..."), FACT, RULE, NOTE | Each tag appears in a different part of Now. |
| One short sentence per entry (under 300 characters). The long detail stays in the note's own sections. | Entries are for skimming. |
| Close finished work: a FIXED or DONE entry with `"closes": ["a"]` for a FAILED or TODO that was resolved. Open items stay open. | Now lists only what is still open. |
| One STATUS entry that says where the project stands today, last. | Chats answer "where are we" from it. |
| Aliases: 5 to 12 words a person would really use ("film", "recording", "video"), including near-synonyms and short names. | This is what fixes wording misses in search. |
| No secrets (keys, tokens, passwords). Say where they live instead. | The tool refuses them anyway. |

## 3. Preview (changes nothing)

Run `node "<worker>" "<note path>" "<spec path>"`. It prints the new **Now** block and a check line. Show the user the Now block in a short table (Status, Open items, Done) and say plainly: "0 original lines lost" only if the check line says it. If it says NOT CONVERTED, read the reasons, fix the spec and run it again. Never apply a failed result.

## 4. Apply only after a yes

When the user says yes for that note, run the same command with `--apply`. It copies the old note to `<memory folder>/.convert-backup/` first, then writes the layered note. Tell the user where the backup is and how to undo (copy it back over the note).

## 5. Finish

After the last note, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/note-check.js" "<memory folder>" --strict` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/note-gen.js" "<memory folder>"`. Report in a short table: notes converted, notes left as they are, anything that needs attention. If the memory folder is a git repo, the next backup will include the change.

## Rules

- One note at a time through steps 2 to 4. Never apply several notes on one "yes".
- A note that already has a `## Log` is refused. Do not try to force it.
- Never edit the Now or Map by hand. After the conversion, add new facts with `memory_add`.
- If unsure what a line means, put it in a NOTE entry or leave it in the detail section. Do not guess.
