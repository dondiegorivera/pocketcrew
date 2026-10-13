import assert from "node:assert/strict";
import { needs } from "./test-needs.ts";
import { test } from "node:test";
import { FLEET } from "./fleet.ts";
import { roleProblems } from "./safety.ts";
import { boundaries, parseRole, ROLE_SECTIONS } from "./role-format.ts";
import { ROLES } from "./roles.gen.ts";

const role = (body: (s: string) => string) => `# X\n\n${ROLE_SECTIONS.map((s) => `## ${s}\n${body(s)}`).join("\n\n")}`;

test("every agent has a role file in the fixed shape that names only tools it has", () => {
	assert.deepEqual(roleProblems(), []);
	for (const name of Object.keys(FLEET)) assert.equal(typeof parseRole(ROLES[name]!), "object", name);
});

test("a role must keep the sections in order, fill them, and stay short", () => {
	assert.equal(typeof parseRole(role((s) => `text for ${s}`)), "object");
	assert.match(parseRole("## Purpose\nx") as string, /title/);
	assert.match(parseRole(role((s) => (s === "Output" ? "" : "x"))) as string, /Empty sections: Output/);
	assert.match(parseRole(role(() => "x").replace("## Inputs", "## Sources")) as string, /must be, in order/);
	assert.match(parseRole(role(() => "word ".repeat(80))) as string, /keep a role within/);
});

test("a role that promises a tool or MCP server the agent lacks is caught", { skip: needs("ops", "web") }, () => {
	const fleet = { ops: FLEET.ops };
	const text = role((s) => (s === "Inputs" ? "the web (web_search) and mcp_github_search_code" : "x"));
	assert.deepEqual(roleProblems(fleet, { ops: text }), ["ops: its role names web_search, which it does not have", "ops: its role names MCP server github, which it does not have"]);
	assert.deepEqual(roleProblems(fleet, {}), ["ops: no role file roles/ops.md"]);
});

test("the Lead's dispatch line carries each specialist's first limits", { skip: needs("google") }, () => {
	const mail = parseRole(ROLES.mail!);
	assert.ok(typeof mail === "object");
	const first = mail.sections["Does not"].split("\n")[0]!.replace(/^[-*\d.]+\s*/, "").split(/[:;]|\.(?=\s|$)/)[0]!.trim();
	assert.ok(boundaries(mail).startsWith(first) && boundaries(mail).split("; ").length <= 3, boundaries(mail));
});
