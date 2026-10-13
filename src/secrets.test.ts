import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSecretCache, secret } from "./secrets.ts";

test("a Worker secret is read as is; a store secret is read, cached for minutes, and re-read when fresh is asked", async () => {
	clearSecretCache();
	assert.equal(await secret({ TELEGRAM_CHAT_ID: "-100" }, "TELEGRAM_CHAT_ID"), "-100");
	assert.equal(await secret({}, "GOOGLE_CLIENT_ID"), "", "unset is empty, not an error");
	let value = "v1";
	let reads = 0;
	const env = { TELEGRAM_WEBHOOK_SECRET: { get: async () => (reads++, value) } };
	assert.equal(await secret(env, "TELEGRAM_WEBHOOK_SECRET", { now: 0 }), "v1");
	value = "v2";
	assert.equal(await secret(env, "TELEGRAM_WEBHOOK_SECRET", { now: 60_000 }), "v1", "cached");
	assert.equal(await secret(env, "TELEGRAM_WEBHOOK_SECRET", { now: 60_000, fresh: true }), "v2", "a rotation is seen at once when asked");
	assert.equal(await secret(env, "TELEGRAM_WEBHOOK_SECRET", { now: 3 * 60_000 }), "v2", "the fresh read refilled the cache");
	assert.equal(reads, 2);
	const broken = { ANTHROPIC_API_KEY: { get: async () => Promise.reject(new Error("no such secret")) } };
	assert.equal(await secret(broken, "ANTHROPIC_API_KEY", { fresh: true }), "", "a missing store secret reads as unset");
});
