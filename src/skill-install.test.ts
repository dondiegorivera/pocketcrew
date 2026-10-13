import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSkill, folderApi, rawUrl } from "./skill-install.ts";
import { SkillsStore } from "./skills.ts";
import { memorySql } from "./test-sql.ts";

const SKILL = "---\nname: memo\ndescription: Memo format\n---\nOne page.";

test("GitHub file and folder links become raw and contents-API URLs", () => {
	assert.equal(rawUrl(new URL("https://github.com/o/r/blob/main/skills/memo/SKILL.md")), "https://raw.githubusercontent.com/o/r/main/skills/memo/SKILL.md");
	assert.equal(rawUrl(new URL("https://example.com/SKILL.md")), "https://example.com/SKILL.md");
	assert.equal(folderApi(new URL("https://github.com/o/r/tree/main/skills/memo/")), "https://api.github.com/repos/o/r/contents/skills/memo?ref=main");
	assert.equal(folderApi(new URL("https://github.com/o/r/blob/main/x.md")), undefined);
});

test("fetchSkill reads a folder's SKILL.md and its text reference files", async () => {
	const urls: string[] = [];
	const f = (async (url: string) => {
		urls.push(url);
		if (url.startsWith("https://api.github.com/"))
			return Response.json([
				{ type: "file", name: "SKILL.md", download_url: "https://raw/SKILL.md" },
				{ type: "file", name: "example.md", download_url: "https://raw/example.md" },
				{ type: "file", name: "run.py", download_url: "https://raw/run.py" },
			]);
		return new Response(url.endsWith("SKILL.md") ? SKILL : "EXAMPLE");
	}) as typeof fetch;
	const s = await fetchSkill("https://github.com/o/r/tree/main/skills/memo", f);
	assert.deepEqual(s, { name: "memo", description: "Memo format", body: "One page.", files: { "example.md": "EXAMPLE" } });
	assert.ok(!urls.some((u) => u.endsWith(".py")), "scripts are not fetched");
});

test("fetchSkill refuses plain http, bad skills and failed downloads with a reason", async () => {
	assert.match((await fetchSkill("http://example.com/SKILL.md")) as string, /https/);
	assert.match((await fetchSkill("https://x/SKILL.md", (async () => new Response("no front matter")) as typeof fetch)) as string, /front matter/);
	assert.match((await fetchSkill("https://x/SKILL.md", (async () => new Response("", { status: 404 })) as typeof fetch)) as string, /HTTP 404/);
});

test("proposals left by earlier versions go live instead of waiting for an approval that no longer exists", () => {
	const sql = memorySql();
	sql("CREATE TABLE skill_proposals (name TEXT PRIMARY KEY, description TEXT, agents TEXT, body TEXT, files TEXT, origin TEXT, updated INTEGER)");
	sql("INSERT INTO skill_proposals VALUES ('memo', 'Memo', '[]', 'b', '{}', 'https://x', 1)");
	const store = new SkillsStore(sql);
	assert.equal(store.get("memo")!.origin, "https://x");
	assert.equal(sql("SELECT name FROM sqlite_master WHERE name = 'skill_proposals'").length, 0);
});
