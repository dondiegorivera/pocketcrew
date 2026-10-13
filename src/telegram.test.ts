import assert from "node:assert/strict";
import { test } from "node:test";
import { chunks, command } from "./telegram.ts";

test("chunks keeps short text whole and splits long text at line breaks", () => {
	assert.deepEqual(chunks("hi"), ["hi"]);
	assert.deepEqual(chunks(""), [""]);
	const long = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
	assert.deepEqual(chunks(long), ["a".repeat(3000), "b".repeat(3000)]);
	assert.ok(chunks("x".repeat(9000)).every((c) => c.length <= 4096));
});

test("command parses verb, bot suffix and argument", () => {
	assert.deepEqual(command("/stop scout"), ["stop", "scout"]);
	assert.deepEqual(command("/Status@pocketcrew_bot"), ["status", ""]);
	assert.equal(command("hello /stop"), undefined);
});

test("trust: only the operator's messages, taps and new reactions in the fleet's group count", async () => {
	const { operatorMessage, operatorReactions, operatorTap, quietHours } = await import("./telegram.ts");
	const ids = { user: "1", chat: "-100" };
	const msg = (from: number, chat = -100, sender_chat?: number) => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: "supergroup" }, from: { id: from }, ...(sender_chat ? { sender_chat: { id: sender_chat } } : {}), text: "hi" } });
	assert.ok(operatorMessage(msg(1), ids));
	assert.ok(operatorMessage(msg(999, -100, -100), ids), "the group's anonymous admin");
	assert.ok(!operatorMessage(msg(2), ids), "someone else in the group");
	assert.ok(!operatorMessage(msg(1, -200), ids), "the operator elsewhere");
	const tap = (from: number, chat = -100) => ({ update_id: 2, callback_query: { id: "c", from: { id: from }, data: "s:1:keep", message: { message_id: 5, chat: { id: chat } } } });
	assert.ok(operatorTap(tap(1), ids));
	assert.ok(!operatorTap(tap(2), ids));
	assert.ok(!operatorTap(tap(1, -200), ids));
	const react = (user: number, now: string[], before: string[] = [], chat = -100) => ({ update_id: 3, message_reaction: { chat: { id: chat }, message_id: 9, user: { id: user }, new_reaction: now.map((emoji) => ({ type: "emoji", emoji })), old_reaction: before.map((emoji) => ({ type: "emoji", emoji })) } });
	assert.deepEqual(operatorReactions(react(1, ["❤"]), ids), ["❤"]);
	assert.deepEqual(operatorReactions(react(1, ["❤", "✍"], ["❤"]), ids), ["✍"], "only what was just added");
	assert.deepEqual(operatorReactions(react(1, [], ["❤"]), ids), [], "taking one away does nothing");
	assert.deepEqual(operatorReactions(react(2, ["❤"]), ids), []);
	assert.deepEqual(operatorReactions(react(1, ["❤"], [], -200), ids), []);
	assert.ok(quietHours(Date.UTC(2026, 9, 12, 21, 0)), "23:00 Berlin is quiet");
	assert.ok(!quietHours(Date.UTC(2026, 9, 12, 8, 0)), "10:00 is not");
	assert.ok(quietHours(Date.UTC(2026, 9, 12, 4, 30)), "06:30 still is");
});
