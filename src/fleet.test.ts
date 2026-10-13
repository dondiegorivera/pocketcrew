import assert from "node:assert/strict";
import { needs, PRIVATE_SAFE } from "./test-needs.ts";
import { test } from "node:test";
import { type AgentSpec, baseName, FLEET, specialists } from "./fleet.ts";
import { jobInstructions } from "./instructions.ts";
import { fleetProblems, inputProblem, passesTo } from "./safety.ts";

test("the shipped fleet passes its own checks", () => {
	assert.deepEqual(fleetProblems(), []);
});

test("fleetProblems catches a second lead, a share of 0, and a lead that reads the web", { skip: needs("web") }, () => {
	const lead = FLEET.lead as AgentSpec;
	const problems = fleetProblems({ a: lead, b: { ...lead, share: 0, tools: ["dispatch", "web_fetch"] } });
	assert.ok(problems.some((p) => p.includes("exactly one lead")));
	assert.ok(problems.some((p) => p.includes("share must be above 0")));
	assert.ok(problems.some((p) => p.includes("reads no web")));
});

test("fleetProblems refuses private data, untrusted content and a way out in one agent, MCP servers included", { skip: needs("web") }, () => {
	const lead = FLEET.lead as AgentSpec;
	const research = FLEET.research as AgentSpec;
	const notesAndWeb = { ...research, tools: [...research.tools, "remember" as const] };
	assert.ok(fleetProblems({ lead, research: notesAndWeb }).some((p) => p.startsWith("research: private data")));
	const notesAndMcp = { ...research, tools: ["remember" as const], mcp: research.mcp };
	assert.ok(fleetProblems({ lead, research: notesAndMcp }).some((p) => p.startsWith("research: private data")));
	assert.ok(!fleetProblems({ lead, research: { ...research, tools: ["remember", "library_search"], mcp: [] } }).some((p) => p.startsWith("research:")));
});

test("job workers map back to their agent", () => {
	assert.equal(baseName("research~41"), "research");
	assert.equal(baseName("lead"), "lead");
});

test("Mail, Calendar and Clerk keep their results from the Lead and out of the library; Research does not", { skip: needs("google", "web") }, async () => {
	const { filesInLibrary, reportsToLead } = await import("./safety.ts");
	for (const name of ["mail", "calendar", "clerk", "mail~7"]) assert.ok(!filesInLibrary(name), name);
	for (const name of ["mail", "calendar", "clerk"]) assert.ok(!reportsToLead(name), name);
	assert.ok(reportsToLead("research") && filesInLibrary("research~3"));
});

test("chained jobs: private results reach only private agents without a way out; web results reach anyone safe", { skip: needs("google", "ops", "web") }, () => {
	assert.equal(inputProblem("clerk", ["mail", "ops"]), undefined);
	assert.equal(inputProblem("calendar", ["mail"]), undefined);
	const said = inputProblem("research", ["mail"])!;
	assert.match(said, /^mail's results .* research must not get\. They may go to: /);
	assert.deepEqual(/may go to: (.*)\.$/.exec(said)![1]!.split(", ").sort(), PRIVATE_SAFE);
	assert.ok(inputProblem("radar", ["clerk"]));
	assert.equal(inputProblem("radar", ["research"]), undefined);
	assert.equal(inputProblem("clerk", ["research"]), undefined, "web findings may be checked against private documents");
	for (const src of specialists()) for (const t of passesTo(src)) assert.equal(inputProblem(t, [src]), undefined);
});

test("private agents get the fixed status fields, the others the free summary", { skip: needs("google", "web") }, () => {
	assert.match(jobInstructions("clerk~4"), /STATUS: done \| nothing-found \| needs-operator \| blocked/);
	const next = /NEXT: the agent that should take the result further \(one of ([^)]*)\)/.exec(jobInstructions("clerk"))![1]!.split(", ");
	assert.ok(next.includes("research") && next.includes("mail"), next.join(", "));
	assert.doesNotMatch(jobInstructions("research~2"), /STATUS:/);
});

test("plugins: the enabled ones fit, and the build refuses collisions, missing kits and unknown tools", async () => {
	const { pluginProblems } = await import("./safety.ts");
	const { plugins } = await import("./plugins.gen.ts");
	const { CORE_FLEET } = await import("./fleet.ts");
	const { CORE_TOOLS } = await import("./tools.ts");
	const { CORE_MCP } = await import("./mcp.ts");
	const { CORE_VIEWS } = await import("./repo-views.ts");
	const { KITS } = await import("./toolkits.ts");
	const core = { agents: Object.keys(CORE_FLEET), tools: Object.keys(CORE_TOOLS), kits: Object.keys(KITS).filter((k) => !plugins().some((p) => k in (p.kits ?? {}))), mcp: Object.keys(CORE_MCP), views: Object.keys(CORE_VIEWS) };
	assert.deepEqual(pluginProblems(plugins(), core), [], "the enabled plugins");
	const spec = { ...FLEET.research!, tools: ["dispatch", "made_up"], mcp: [], repos: ["nowhere"] } as AgentSpec;
	const bad = [
		{ name: "Bad Name", about: "", agents: { lead: spec }, tools: { dispatch: { kit: "lead", risks: [] }, odd: { kit: "nokit", risks: ["private" as const] } } },
		{ name: "dup", about: "" },
		{ name: "dup", about: "" },
	];
	const problems = pluginProblems(bad, core).join("\n");
	for (const p of [/a name is lowercase/, /"dup" is enabled twice/, /agent "lead" is already core's/, /tool "dispatch" is already core's/, /kit "nokit", which no one has/, /names tool "made_up"/, /names repo view "nowhere"/])
		assert.match(problems, p);
});

test("core alone is a sound fleet: the Lead, with its tools, and every safety check passing", async () => {
	const { CORE_FLEET } = await import("./fleet.ts");
	const { fleetProblems } = await import("./safety.ts");
	assert.deepEqual(Object.keys(CORE_FLEET), ["lead"]);
	assert.deepEqual(fleetProblems({ lead: { ...CORE_FLEET.lead, share: 1 } }), [], "with all the budget, the Lead alone passes");
	const { testDirector } = await import("./director/test-kit.ts");
	const t = testDirector();
	await t.s.commands.dispatch(t.text("hello"));
	assert.equal(t.called("receive", "lead").length, 1, "and talks, with no plugin loaded");
});
