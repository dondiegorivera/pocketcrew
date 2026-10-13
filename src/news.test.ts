import assert from "node:assert/strict";
import { test } from "node:test";
import { addNews, newsLine, newsText } from "./news.ts";

const DAY = 86_400_000;

test("news: commit titles without tickets or housekeeping, a week long, newest first", () => {
	assert.equal(newsLine("C-049, C-050: settings in one file"), "settings in one file");
	assert.equal(newsLine("C-055 (audit part): core lines made generic"), "core lines made generic");
	assert.equal(newsLine("Routines move in place: move_routine"), "Routines move in place: move_routine");
	assert.equal(newsLine("Board: C-054 covers releases"), undefined);
	assert.equal(newsLine("Handbook: plugins"), undefined);
	let n = addNews([], ["C-1: old thing"], 0);
	n = addNews(n, ["Routines move in place", "Board: x"], 2 * DAY);
	assert.deepEqual(n.map((e) => e.lines), [["Routines move in place"], ["old thing"]]);
	n = addNews(n, [], 8 * DAY);
	assert.deepEqual(n.map((e) => e.lines), [["Routines move in place"]], "a week later the oldest is gone");
	const text = newsText(n, 8 * DAY, () => "Tue 13 Oct");
	assert.match(text, /^Shipped to the fleet this week/);
	assert.match(text, /- Tue 13 Oct: Routines move in place$/);
	assert.equal(newsText(n, 20 * DAY, () => ""), "");
	assert.equal(addNews([], Array.from({ length: 30 }, (_, i) => `change ${i}`), 0)[0]!.lines.length, 15);
});
