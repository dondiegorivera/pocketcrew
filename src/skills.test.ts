import assert from "node:assert/strict";
import { needs } from "./test-needs.ts";
import { test } from "node:test";
import { catalogText, MAX_SKILL_CHARS, parseSkill, type Skill, skillScope, SkillsStore, skillText, visibleTo } from "./skills.ts";
import { BUNDLED_SKILLS } from "./skills.gen.ts";
import { memorySql } from "./test-sql.ts";

test("parseSkill reads the front matter and the instructions", () => {
	const s = parseSkill("---\nname: memo-format\ndescription: \"How memos look\"\nagents: research, lead\n---\n\n# Memo\nOne page.\n");
	assert.deepEqual(s, { name: "memo-format", description: "How memos look", agents: ["research", "lead"], body: "# Memo\nOne page." });
	assert.deepEqual((parseSkill("---\nname: a\ndescription: b\n---\nx") as Skill).agents, [], "no agents line: every agent");
});

test("parseSkill explains what is wrong", () => {
	assert.match(parseSkill("no front matter") as string, /front matter/);
	assert.match(parseSkill("---\nname: Bad Name\ndescription: d\n---\nx") as string, /lowercase/);
	assert.match(parseSkill("---\nname: ok\n---\nx") as string, /description/);
	assert.match(parseSkill("---\nname: ok\ndescription: d\n---\n") as string, /empty/);
	assert.match(parseSkill(`---\nname: ok\ndescription: d\n---\n${"x".repeat(MAX_SKILL_CHARS + 1)}`) as string, /reference files/);
});

test("the repo's skills bundle and each names who may use it", { skip: needs("google") }, () => {
	assert.ok(BUNDLED_SKILLS.some((s) => s.name === "html-report" && s.agents.length === 0), "every agent may publish pages");
	assert.ok(BUNDLED_SKILLS.some((s) => s.name === "inbox-rules" && s.agents.join() === "mail"));
	for (const s of BUNDLED_SKILLS) assert.equal(s.source, "repo");
});

test("a save is live at once, and undo steps back through earlier versions to the repo's", () => {
	const store = new SkillsStore(memorySql());
	store.save({ name: "memo", description: "Memos", agents: ["lead"], body: "v1" }, 1);
	store.save({ name: "memo", description: "Memos", agents: ["lead"], body: "v2" }, 2);
	assert.equal(store.get("memo")!.body, "v2");
	assert.ok(visibleTo(store.get("memo")!, "lead") && !visibleTo(store.get("memo")!, "research"));
	assert.equal(store.undo("memo"), "restored");
	assert.equal(store.get("memo")!.body, "v1");
	assert.equal(store.undo("memo"), "removed", "before v1 there was only the repo's version, if any");
	assert.equal(store.undo("memo"), undefined);
	store.save({ name: "memo", description: "Memos", agents: [], body: "v3" }, 3);
	assert.ok(store.remove("memo") && !store.get("memo"));
	assert.equal(store.undo("memo"), "restored", "a delete can be undone too");
	assert.equal(store.get("memo")!.body, "v3");
});

test("the catalog lists names and descriptions only; skillText gives the rest", () => {
	const s: Skill = { name: "memo", description: "Memos", agents: [], body: "BODY", files: { "example.md": "EX" }, source: "repo" };
	assert.equal(catalogText([]), undefined);
	const catalog = catalogText([s])!;
	assert.match(catalog, /- memo: Memos/);
	assert.ok(!catalog.includes("BODY"));
	assert.match(skillText(s), /BODY[\s\S]*example\.md/);
	assert.equal(skillText(s, "example.md"), "EX");
	assert.match(skillText(s, "nope.md"), /no file/);
});

test("the newer copy of a skill wins, and a bundled copy that caught up retires the chat copy", async () => {
	const { mergeSkills, superseded, skillMarkdown } = await import("./skills.ts");
	const repo = (updated?: number): Skill => ({ name: "memo", description: "Repo", agents: [], body: "R", files: {}, source: "repo", ...(updated ? { updated } : {}) });
	const chat = (updated: number): Skill => ({ name: "memo", description: "Chat", agents: [], body: "C", files: {}, source: "chat", updated });
	assert.equal(mergeSkills([repo()], [chat(5)])[0]!.description, "Chat", "a chat edit of a hand-written repo skill");
	assert.equal(mergeSkills([repo(5)], [chat(5)])[0]!.description, "Repo", "committed and deployed");
	assert.equal(mergeSkills([repo(5)], [chat(9)])[0]!.description, "Chat", "edited again since the commit");
	assert.deepEqual(superseded([repo(5)], [chat(5)]), ["memo"]);
	assert.deepEqual(superseded([repo(5)], [chat(9)]), []);
	assert.deepEqual(superseded([], [chat(9)]), []);
	const md = skillMarkdown({ name: "memo", description: "Memo\nformat", agents: ["lead"], body: "One page.", updated: 9, origin: "https://x/SKILL.md" });
	assert.deepEqual(parseSkill(md), { name: "memo", description: "Memo format", agents: ["lead"], body: "One page.", updated: 9, origin: "https://x/SKILL.md" });
});

test("skills from outside text never reach the Lead", () => {
	const fleet = { all: ["lead", "research", "mail"], lead: "lead" };
	assert.deepEqual(skillScope([], false, fleet), [], "the Lead's own skill: every agent");
	assert.deepEqual(skillScope([], true, fleet), ["research", "mail"], "from Research or a URL: specialists only");
	assert.deepEqual(skillScope(["lead", "research"], true, fleet), ["research"]);
	assert.match(skillScope(["lead"], true, fleet) as string, /only the Lead/);
	assert.match(skillScope(["nobody"], false, fleet) as string, /No agent nobody/);
});
