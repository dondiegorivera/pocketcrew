// The server's routes (sync-export.ts) are listed in its header; each listed route must still have its handler, so a
// refactor cannot drop one quietly (the health route that `npm run smoke` reads once went missing that way).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("every route sync-export.ts lists has a handler", () => {
	const src = readFileSync(new URL("./sync-export.ts", import.meta.url), "utf8");
	const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
	const listed = [...src.matchAll(/^\/\/\s+(?:GET|PUT|POST)\s+(\/[^\s?]+)/gm)].map((m) => m[1]!).filter((p) => !p.includes("<"));
	assert.ok(listed.length > 5);
	for (const path of listed) assert.ok(code.includes(`"${path}"`), `no handler for ${path}`);
});
