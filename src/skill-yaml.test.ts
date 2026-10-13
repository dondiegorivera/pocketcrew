// SKILL.md front matter is YAML to everyone else (GitHub renders it, other agents' tools read it): a value YAML would
// misread is written quoted, and reads back the same.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSkill, skillMarkdown, yamlScalar, yamlValue } from "./skill-format.ts";

test("front matter values YAML would misread are quoted, and read back unchanged", () => {
	for (const v of ["plain words", "How it works: in steps", "a # not a comment", "- leading dash", "'quoted' start", 'say "hi": now', ""])
		assert.equal(yamlScalar(yamlValue(v)), v);
	assert.equal(yamlValue("plain words"), "plain words");
	assert.equal(yamlValue("How it works: in steps"), '"How it works: in steps"');
	const md = skillMarkdown({ name: "x", description: "Recipe: three steps", agents: [], body: "Body." });
	assert.match(md, /^description: "Recipe: three steps"$/m);
	const back = parseSkill(md);
	assert.ok(typeof back === "object" && back.description === "Recipe: three steps");
});

test("every SKILL.md in the repo has front matter YAML can read", () => {
	const files = execFileSync("git", ["ls-files", "*SKILL.md"], { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim().split("\n");
	for (const f of files) {
		const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))?.[1] ?? "";
		for (const line of head.split("\n")) {
			const value = /^[a-z]+:\s*(.*)$/.exec(line)?.[1] ?? "";
			assert.equal(yamlValue(yamlScalar(value)), value, `${f}: ${line.slice(0, 60)}`);
		}
	}
});
