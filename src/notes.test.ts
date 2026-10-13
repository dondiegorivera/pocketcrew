import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NOTE_CHARS, NotesStore } from "./notes.ts";
import { memorySql } from "./test-sql.ts";

test("notes are added once per tool call, rendered for the prompt, and forgotten by number", () => {
	const notes = new NotesStore(memorySql());
	assert.equal(notes.render(), undefined, "no section without notes");
	assert.equal(notes.add("remember:t1", "  My accountant is   Novak Ltd. "), "Noted as #1.");
	assert.equal(notes.add("remember:t1", "My accountant is Novak Ltd."), "Noted as #1.", "a replayed call adds nothing");
	notes.add("remember:t2", "No meetings before 9.");
	assert.match(notes.render()!, /#1 My accountant is Novak Ltd\.\n#2 No meetings before 9\.$/);
	assert.match(notes.remove(1), /Forgot #1/);
	assert.match(notes.remove(1), /No note #1/);
	assert.match(notes.add("remember:t3", "x".repeat(MAX_NOTE_CHARS + 1)), /Too long/);
	assert.match(notes.add("remember:t4", "   "), /empty/);
});
