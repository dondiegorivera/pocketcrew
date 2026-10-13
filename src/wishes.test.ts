import assert from "node:assert/strict";
import { test } from "node:test";
import { memorySql } from "./test-sql.ts";
import { parseWish, wishBrief, WishStore } from "./wishes.ts";

test("wishes wait oldest first, a replayed add is one wish, and only waiting ones can be dropped", () => {
	const store = new WishStore(memorySql());
	const a = store.add("k1", "research", "deep dive on agent payments", undefined, undefined, 1);
	assert.equal(store.add("k1", "research", "deep dive on agent payments", undefined, undefined, 2), a, "same key, same wish");
	const b = store.add("k2", "scout", "sweep the .de names", "portfolio", undefined, 3);
	assert.equal(store.waiting(), 2);
	assert.equal(store.next()?.id, a);
	store.started(a, 41);
	assert.equal(store.next()?.id, b);
	assert.match(store.drop(a), /already ran as job #41/);
	assert.match(store.drop(b), /dropped/);
	assert.equal(store.next(), undefined);
	assert.match(store.text(), /Nothing waiting[\s\S]*job #41/);
	assert.match(wishBrief({ id: 7, task: "x" }), /^Wish #7\.[\s\S]*wishlist[\s\S]*\n\nx$/);
});

test("/wish takes an optional agent and model before the task", () => {
	const sp = ["research", "scout", "ops"];
	assert.deepEqual(parseWish("scout opus tidy the owned-domains list\nand the freeze notes", sp), { agent: "scout", model: "opus", task: "tidy the owned-domains list\nand the freeze notes" });
	assert.deepEqual(parseWish("Opus compare the three hosting offers", sp), { agent: "research", model: "opus", task: "compare the three hosting offers" });
	assert.deepEqual(parseWish("ops weekly traffic digest", sp), { agent: "ops", model: undefined, task: "weekly traffic digest" });
	assert.deepEqual(parseWish("opera houses in Vienna", sp), { agent: "research", model: undefined, task: "opera houses in Vienna" });
	assert.equal(parseWish("scout sonnet", sp), undefined);
	const all = ["research", "mail", "clerk"];
	assert.deepEqual(parseWish("Email opus analyse my old labels", all), { agent: "mail", model: "opus", task: "analyse my old labels" }, "everyday names reach the agent");
	assert.deepEqual(parseWish("opus mail: analyse my old labels", all), { agent: "mail", model: "opus", task: "analyse my old labels" }, "either order");
	const store = new WishStore(memorySql());
	store.add("k", "scout", "x", undefined, "claude-opus-5-5");
	assert.equal(store.next()?.model, "claude-opus-5-5");
	assert.match(store.text(), /#1 scout · opus-5-5/);
});
