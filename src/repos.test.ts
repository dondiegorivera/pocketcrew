import assert from "node:assert/strict";
import { needs } from "./test-needs.ts";
import { test } from "node:test";
import { matches } from "./repo-views.ts";
import { RepoStore } from "./repos.ts";
import { memorySql } from "./test-sql.ts";

test("globs: * stays in a folder, ** crosses folders", () => {
	assert.ok(matches("domains/a.com.md", "domains/*.md"));
	assert.ok(!matches("domains/sub/a.md", "domains/*.md"));
	assert.ok(matches("a/b/c.md", "**/*.md"));
	assert.ok(matches("README.md", "**/*.md"), "a file at the top of the repo");
	assert.ok(matches(".obsidian/app.json", ".obsidian/**"));
	assert.ok(!matches("notes/README.mdx", "**/*.md"));
	assert.ok(!matches("domains/a.com.mdx", "domains/*.md"));
});

test("reads show pending writes; writes are refused outside the view's writable files; replays add nothing", { skip: needs("notes") }, () => {
	const store = new RepoStore(memorySql());
	store.replace("notes", { "inbox.md": "# Inbox\n", "trips/a.md": "# a" }, "abc123");
	assert.match(store.queueWrite("k1", "notes", "notes", "inbox.md", "append", "| row |", "add row"), /Write #1 queued/);
	assert.match(store.queueWrite("k1", "notes", "notes", "inbox.md", "append", "| row |", "add row"), /already queued/);
	assert.match(store.queueWrite("k2", "notes", "notes", "data.json", "replace", "{}", "x"), /not writable/);
	assert.equal(store.content("notes", "inbox.md"), "# Inbox\n| row |");
	assert.match(store.grep("notes", "row", "*.md"), /inbox\.md:2: \| row \|/);
	assert.match(store.files("notes"), /at abc123, uploaded .* · 2 files/);
	const failed = store.ack([{ id: 1, status: "failed", result: "check failed" }]);
	assert.equal(failed[0]!.path, "inbox.md");
	assert.equal(store.content("notes", "inbox.md"), "# Inbox\n", "a failed write no longer shows");
});
