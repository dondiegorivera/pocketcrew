import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "./library.ts";
import { memorySql } from "./test-sql.ts";
import { VaultStore } from "./vault.ts";

test("private reports are kept once per job, exported in order, and never reach library search", () => {
	const sql = memorySql();
	const vault = new VaultStore(sql);
	const lib = new LibraryStore(sql);
	const r = { job: 7, agent: "mail", project: null, title: "Inbox sorted", brief: "b", summary: "s", body: "invoice from the dentist", cost: 0.01 };
	const id = vault.add(r, 1);
	assert.equal(vault.add(r, 2), id, "a repeated delivery is one report");
	vault.add({ ...r, job: 8 }, 3);
	assert.deepEqual(vault.after(0).map((x) => x.job), [7, 8]);
	assert.deepEqual(vault.after(id).map((x) => x.job), [8]);
	assert.match(lib.search("dentist"), /No reports match/);
});
