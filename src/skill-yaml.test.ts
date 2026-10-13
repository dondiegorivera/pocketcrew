// SKILL.md front matter is YAML to everyone else (GitHub renders it, other agents' tools read it): a value YAML would
// misread is written quoted, and reads back the same.
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
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
	// From disk, not git: the check also runs in a fresh export that has no commits yet.
	const root = new URL("..", import.meta.url);
	const files = ["skills", "plugins", "oss/public"].flatMap((dir) => globSync(`${dir}/**/SKILL.md`, { cwd: root, exclude: (p) => p.includes("node_modules") }));
	assert.ok(files.length > 5);
	for (const f of files) {
		const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))?.[1] ?? "";
		for (const line of head.split("\n")) {
			const value = /^[a-z]+:\s*(.*)$/.exec(line)?.[1] ?? "";
			assert.equal(yamlValue(yamlScalar(value)), value, `${f}: ${line.slice(0, 60)}`);
		}
	}
});
