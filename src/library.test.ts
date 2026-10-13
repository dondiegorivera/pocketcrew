import assert from "node:assert/strict";
import { test } from "node:test";
import { ftsTerms, LibraryStore, type NewReport } from "./library.ts";
import { memorySql } from "./test-sql.ts";

const report = (job: number, over: Partial<NewReport> = {}): NewReport => ({
	job, agent: "research", project: null, title: `Report ${job}`, brief: "brief", summary: "summary", body: "body", cost: 0.01, ...over,
});

test("ftsTerms keeps words only, so FTS syntax in a query cannot break the search", () => {
	assert.deepEqual(ftsTerms('agent* "escrow" OR (domains)'), ['"agent"*', '"escrow"*', '"or"*', '"domains"*']);
	assert.deepEqual(ftsTerms("  ..  "), []);
});

test("add files a job's report once and search ranks title matches", () => {
	const lib = new LibraryStore(memorySql());
	const a = lib.add(report(1, { title: "Buyers for agent escrow domains", body: "Funded startups..." }), Date.UTC(2026, 9, 10));
	const b = lib.add(report(2, { title: "Accountant checklist", body: "Mentions escrow once." }));
	assert.equal(lib.add(report(1)), a, "a second delivery of job 1 is the same report");
	assert.notEqual(a, b);
	const hits = lib.search("escrow").split("\n").filter((l) => l.startsWith("#"));
	assert.equal(hits.length, 2);
	assert.match(hits[0]!, /^#1 · 2026-10-10 · research · Buyers for agent escrow domains/);
	assert.match(lib.search("escrow accountant"), /#2/, "falls back to any word when no report has every word");
	assert.match(lib.search("nothing-like-this"), /No reports match/);
	assert.match(lib.search(""), /#2.*\n.*\n#1/s, "an empty query lists the newest first");
});

test("search finds a routine's earlier runs by the name in their brief", () => {
	const lib = new LibraryStore(memorySql());
	lib.add(report(5, { brief: 'Routine "morning-ai-news" (routine #1), scheduled run.' }));
	assert.match(lib.search("morning-ai-news"), /#1/);
});

test("read pages through a long report and after() feeds the export in order", () => {
	const lib = new LibraryStore(memorySql());
	const id = lib.add(report(9, { body: "x".repeat(20_000), project: "tt" }));
	const first = lib.read(id);
	assert.match(first, /project tt · job #9/);
	assert.match(first, /\[continues: library_read id=1 from=12000\]/);
	assert.ok(!lib.read(id, 12_000).includes("continues"));
	assert.match(lib.read(99), /No report #99/);
	lib.add(report(10));
	assert.deepEqual(lib.after(0).map((r) => r.job), [9, 10]);
	assert.deepEqual(lib.after(1).map((r) => r.job), [10]);
});
