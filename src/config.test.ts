import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG, ZONE_NAME } from "./config.ts";
import { FLEET } from "./fleet.ts";
import { fleetProblems } from "./safety.ts";
import { quietAt } from "./telegram.ts";

test("config: the owner's file over the defaults, the zone's name for text", () => {
	assert.ok(CONFIG.timeZone && Array.isArray(CONFIG.plugins), "pocketcrew.config.ts sets where and what");
	assert.equal(typeof CONFIG.briefingHour, "number");
	assert.equal(ZONE_NAME, CONFIG.timeZone.split("/").pop()!.replace(/_/g, " "));
});

test("config: quiet hours may run past midnight or not", () => {
	assert.deepEqual([21, 22, 3, 7].map((h) => quietAt(h, [22, 7])), [false, true, true, false]);
	assert.deepEqual([12, 13, 14, 15].map((h) => quietAt(h, [13, 15])), [false, true, true, false]);
});

test("config: a change to an agent no plugin adds is a fleet problem", () => {
	assert.deepEqual(fleetProblems(FLEET, { lead: { effort: "medium" } }), []);
	assert.match(fleetProblems(FLEET, { nobody: { share: 0.1 } }).join("\n"), /changes agent "nobody"/);
});
