import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error: plain JavaScript, no types
import { configText, subdomainOf } from "../scripts/setup-config.mjs";

test("setup: the subdomain read back from a workers.dev address, and a config file that loads", async () => {
	assert.equal(subdomainOf("https://pocketcrew.my-team.workers.dev"), "my-team");
	assert.equal(subdomainOf("https://fleet.example.com"), undefined);
	const text = configText({ plugins: ["web"], timeZone: "Europe/Lisbon", url: "https://pocketcrew.x.workers.dev" });
	assert.match(text, /^\/\/ The owner's settings/);
	const mod = await import(`data:text/javascript,${encodeURIComponent(text.replace(/^import type .*$/m, "").replace(/ satisfies Partial<Config>/, ""))}`);
	assert.deepEqual(mod.default.plugins, ["web"]);
});
