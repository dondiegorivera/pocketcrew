import assert from "node:assert/strict";
import { test } from "node:test";
import { configured, consentUrl, open, SCOPES, seal } from "./oauth.ts";

const KEY = "ab".repeat(32);

test("the refresh token is sealed with AES-GCM and only the key opens it", async () => {
	const sealed = await seal(KEY, "1//refresh-token");
	assert.ok(!sealed.includes("refresh"));
	assert.equal(await open(KEY, sealed), "1//refresh-token");
	assert.notEqual(await seal(KEY, "1//refresh-token"), sealed, "a fresh IV every time");
	await assert.rejects(open("cd".repeat(32), sealed));
});

test("the consent URL asks for offline access, a fresh consent and exactly the fleet's scopes", () => {
	const u = new URL(consentUrl({ id: "cid", secret: "s", redirect: "https://w.example/oauth/google/callback" }, "st"));
	assert.equal(u.searchParams.get("access_type"), "offline");
	assert.equal(u.searchParams.get("prompt"), "consent");
	assert.equal(u.searchParams.get("state"), "st");
	assert.deepEqual(u.searchParams.get("scope")!.split(" "), SCOPES);
	assert.ok(!u.href.includes("secret"), "the client secret never goes into the link");
	assert.ok(!configured({ GOOGLE_CLIENT_ID: "unset", GOOGLE_CLIENT_SECRET: "x", GOOGLE_TOKEN_KEY: KEY }));
	assert.ok(configured({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "x", GOOGLE_TOKEN_KEY: KEY }));
});

test("missing Google permissions are named from the granted scope string", async () => {
	const { missingScopes, SCOPES, SCOPE_NAMES } = await import("./oauth.ts");
	assert.deepEqual(missingScopes(SCOPES.join(" ")), []);
	const without = SCOPES.filter((s) => !s.endsWith("gmail.settings.basic")).join(" ");
	assert.deepEqual(missingScopes(without).map((s) => SCOPE_NAMES[s]), ["Gmail filters"]);
	assert.ok(SCOPES.every((s) => SCOPE_NAMES[s]), "every permission has a name");
});
