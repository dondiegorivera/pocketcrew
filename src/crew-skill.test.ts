// The crew skill describes the fleet to its own agents. These checks keep it from drifting from the code: a new
// agent, tool or command fails the build until the skill names it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { help } from "./help.ts";
import { FLEET } from "./fleet.ts";
import { mergeSkills, parseSkill, type Skill, skillMarkdown } from "./skill-format.ts";
import { BUNDLED_SKILLS } from "./skills.gen.ts";
import { TOOLS } from "./tools.ts";

// As bundled: core's text with each enabled plugin's section (plugins/<name>/skill.md) in it.
const text = skillMarkdown(BUNDLED_SKILLS.find((s) => s.name === "crew")!);

test("the crew skill names every agent, tool and command, and only the developer edits it", () => {
	for (const name of Object.keys(FLEET)) assert.match(text, new RegExp(`^- ${name} \\(`, "m"), `agent ${name}`);
	for (const tool of Object.keys(TOOLS)) assert.ok(text.includes(tool), `tool ${tool}`);
	for (const cmd of new Set(help().match(/\/[a-z]+/g))) assert.ok(text.includes(cmd), `command ${cmd}`);
	const parsed = parseSkill(text);
	assert.ok(typeof parsed !== "string" && parsed.devOnly === true);
});

test("a chat copy never overrides a developer-only repo skill", () => {
	const repo: Skill = { name: "crew", description: "d", agents: [], body: "repo", files: {}, source: "repo", updated: 1, devOnly: true };
	const chat: Skill = { ...repo, body: "chat", source: "chat", updated: 2, devOnly: undefined };
	assert.equal(mergeSkills([repo], [chat])[0]!.body, "repo");
	assert.equal(mergeSkills([{ ...repo, devOnly: undefined }], [chat])[0]!.body, "chat", "unlocked skills: newer wins as before");
});
