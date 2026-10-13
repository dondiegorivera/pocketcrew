import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOf, capabilities, dailyTraffic, diagnoseNoZones, overview, runQuery, spikes, type Traffic } from "./sites.ts";

const days = (pvs: number[]) => pvs.map((pageViews, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, requests: pageViews * 3, pageViews, uniques: Math.ceil(pageViews / 2), threats: 0 }));

test("a spike is a day well above the site's usual level and above a noise floor", () => {
	const t: Traffic = { "a.com": days([10, 12, 9, 11, 10, 60]), "b.com": days([1, 1, 2, 1, 1, 6]), "c.com": days([50, 55, 52, 51, 49, 70]) };
	const found = spikes(t);
	assert.deepEqual(found.map((s) => [s.site, s.date, s.factor]), [["a.com", "2026-10-06", 6]]);
	assert.match(overview(t), /^a\.com: 112 page views[\s\S]*c\.com|^c\.com/);
	assert.equal(overview({ "d.com": days([0, 0]) }), "No traffic on any site in that range.");
});

test("dailyTraffic asks for ten zones per query and maps zone ids back to names", async () => {
	const bodies: { variables: { zones: string[] } }[] = [];
	const f = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		bodies.push(body);
		const zones = body.variables.zones.map((id: string) => ({ zoneTag: id, httpRequests1dGroups: [{ dimensions: { date: "2026-10-09" }, sum: { requests: 9, pageViews: 3, threats: 0 }, uniq: { uniques: 2 } }] }));
		return Response.json({ data: { viewer: { zones } }, errors: null });
	}) as typeof fetch;
	const zones = Array.from({ length: 12 }, (_, i) => ({ id: `z${i}`, name: `site${i}.com` }));
	const t = await dailyTraffic("token", zones, "2026-10-03", "2026-10-09", f);
	assert.deepEqual(bodies.map((b) => b.variables.zones.length), [10, 2]);
	assert.deepEqual(t["site11.com"], [{ date: "2026-10-09", requests: 9, pageViews: 3, uniques: 2, threats: 0 }]);
});

test("a token that sees no sites gets a diagnosis naming the accounts it can reach", async (t) => {
	t.mock.method(console, "log", () => {});
	const f = (async (url: string) =>
		url.includes("/user/tokens/verify") ? Response.json({ success: true, result: { status: "active" } }) : Response.json({ success: true, result: [{ id: "a1", name: "fleet-account" }] })) as typeof fetch;
	const text = await diagnoseNoZones("t", f);
	assert.match(text, /works \(active\) but sees no sites/);
	assert.match(text, /reach these accounts: fleet-account/);
	assert.match(text, /All zones from an account/);
});

test("a drop is a day far below the site's usual level, checked on every site", () => {
	const t: Traffic = { "a.com": days([40, 42, 39, 41, 40, 8]), "b.com": days([10, 12, 9, 11, 10, 2]) };
	assert.deepEqual(spikes(t).map((s) => [s.site, s.kind, s.factor]), [["a.com", "drop", 0.2]], "b.com is under the noise floor");
});

test("cf_graphql fills zone and account tags, chunks by ten, names sites, and refuses mutations", async () => {
	const seen: Record<string, unknown>[] = [];
	const f = (async (_url: string, init: RequestInit) => {
		const { variables } = JSON.parse(String(init.body));
		seen.push(variables);
		return Response.json({ data: { viewer: { zones: (variables.zoneTags ?? []).map((zoneTag: string) => ({ zoneTag, n: 1 })) } }, errors: null });
	}) as typeof fetch;
	const zones = Array.from({ length: 12 }, (_, i) => ({ id: `z${i}`, name: `site${i}.com`, account: i < 11 ? "acct" : "other" }));
	assert.equal(accountOf(zones), "acct");
	const all = await runQuery("t", zones, "query($zoneTags: [string!], $accountTag: string) { x }", { from: "2026-10-01" }, [], f);
	assert.deepEqual(seen.map((v) => (v.zoneTags as string[]).length), [10, 2]);
	assert.equal(seen[0]!.accountTag, "acct");
	assert.equal(seen[0]!.from, "2026-10-01");
	assert.match(all, /"zoneTag":"site11\.com"/);
	assert.match(await runQuery("t", zones, "query { x }", {}, ["nope.com"], f), /Not in the account: nope\.com/);
	assert.match(await runQuery("t", zones, "mutation { x }", {}, [], f), /Only queries/);
});

test("the capability probe reports each field with Cloudflare's reason", async () => {
	const f = (async (_url: string, init: RequestInit) => {
		const { query } = JSON.parse(String(init.body));
		return /botScore|accounts/.test(query) ? Response.json({ data: null, errors: [{ message: "does not have access to the path" }] }) : Response.json({ data: {}, errors: null });
	}) as typeof fetch;
	const lines = await capabilities("t", [{ id: "z", name: "a.com", account: "acct" }], Date.parse("2026-10-11T12:00:00Z"), f);
	assert.ok(lines.includes("✓ httpRequestsAdaptiveGroups (request detail)"));
	assert.ok(lines.includes("✗   dimension botScore: does not have access to the path"));
	assert.ok(lines.some((l) => l.startsWith("✗ workersInvocationsAdaptive")));
});
