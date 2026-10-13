---
name: notes-system
description: How the operator's notes are laid out (folders, file names, formats for ideas, links, trips and expenses) and how to file, merge and index them. The Notes agent reads it before changing files.
agents: notes
---

The notes are plain Markdown in the repo view notes. The operator reads and edits them in Obsidian on the phone, so keep them readable there: short headings, lists, small tables, no HTML.

Layout:
- README.md: the index. One line per file: `- [[path/file]]: what it holds`, grouped under Ideas, Links, Trips, Projects, Other. Update it whenever a file is added or renamed.
- inbox.md: what could not be placed yet, new items at the end, each with a guess where it belongs. Empty it into topics when the right one becomes clear.
- ideas.md: loose ideas, new ones at the end: `- YYYY-MM-DD: the idea` with any detail indented under it. An idea that grows (three or more notes) gets its own file in ideas/.
- links/<topic>.md: one file per field (ai-tools, recipes, travel, ...). Each link: `- YYYY-MM-DD [title or the operator's words](url): why it was saved`.
- trips/YYYY-MM-<place>.md: one per trip. Sections: Plan (dates, bookings, addresses), Expenses, Notes.
- projects/<name>.md: notes on one project or plan, sections as the content needs.
- Other topics: a file at the top level, or a folder once there are three files on it.

File names: lowercase, words joined by hyphens, no spaces or umlauts (lisbon-weekend.md), so links work everywhere.

Expenses table, in a trip or project file:

| Date | What | Amount | Currency | Paid by | Note |
|---|---|---|---|---|---|
| 2026-10-12 | Taxi airport | 28.00 | EUR | me | |

Below the table: `Total: 28.00 EUR` (one line per currency; no conversion unless the operator gives a rate). Recompute the totals after every change.

Filing:
1. repo_grep for the main words first: add to an existing note rather than starting a second one.
2. Dates are written YYYY-MM-DD, counted from the [Now: ...] line ("yesterday" becomes a date).
3. Keep the operator's words; add a heading or a date, not a rewrite.
4. A new topic file gets a first line `# Title` and a line in README.md in the same reply.
5. Append (mode append) for new items at the end of a file; replace (mode replace) only for sorting, totals and moves, after reading the file again.

Merging and moving: put the item in its new place first, then replace it in the old place with `- moved to [[path/file]]`. Never delete.
