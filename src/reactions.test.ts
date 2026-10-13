import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackText, gist, reactionActions, SentStore } from "./reactions.ts";
import { memorySql } from "./test-sql.ts";

test("reactions: each emoji asks for one thing, once", () => {
	assert.deepEqual(reactionActions(["❤"]), ["up"]);
	assert.deepEqual(reactionActions(["👎", "💩"]), ["down"]);
	assert.deepEqual(reactionActions(["✍", "👀"]), ["note", "later"]);
	assert.deepEqual(reactionActions(["🤔"]), ["explain"]);
	assert.deepEqual(reactionActions(["🙈"]), ["hide"]);
	assert.deepEqual(reactionActions(["🍌"]), [], "unknown emoji do nothing");
});

test("feedback: newest first, as a short section, from the gist of each message", () => {
	const s = new SentStore(memorySql());
	s.note(10, { agent: "research", kind: "report", job: 52, text: "📄 Six new models\n#52 · $0.072" });
	assert.equal(s.get(10)!.job, 52);
	assert.equal(gist(s.get(10)!.text), "Six new models", "a report's title");
	assert.equal(gist("#52 · $0.07\nThe actual point"), "The actual point");
	s.addFeedback("research", "up", "short model list with one line each");
	s.addFeedback("research", "down", "long license paragraphs");
	assert.equal(
		feedbackText(s.feedback("research")),
		"How the operator reacted to your recent messages in Telegram. Do more of what they liked and less of what they did not; it says nothing about facts, only about what is useful to them.\n- disliked: long license paragraphs\n- liked: short model list with one line each",
	);
	assert.equal(feedbackText(s.feedback("mail")), "");
});
