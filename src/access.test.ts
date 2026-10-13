import assert from "node:assert/strict";
import { test } from "node:test";
import { accessEmail } from "./access.ts";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag";
const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");

async function setup() {
	const pair = (await crypto.subtle.generateKey(
		{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
	const sign = async (claims: object, kid = "k1") => {
		const head = b64url(JSON.stringify({ alg: "RS256", kid }));
		const body = b64url(JSON.stringify(claims));
		const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
		return `${head}.${body}.${b64url(sig)}`;
	};
	const req = (token?: string) => new Request("https://reports.example/", { headers: token ? { "cf-access-jwt-assertion": token } : {} });
	return { sign, req, certs: async () => [jwk] };
}

const now = Date.UTC(2026, 9, 11);
const valid = { aud: [AUD], iss: `https://${TEAM}`, exp: now / 1000 + 3600, email: "me@example.com" };

test("a valid Access token for this application lets the operator in", async () => {
	const { sign, req, certs } = await setup();
	assert.equal(await accessEmail(req(await sign(valid)), TEAM, AUD, certs, now), "me@example.com");
});

test("no token, another application, another team, an expired or tampered token: closed", async () => {
	const { sign, req, certs } = await setup();
	assert.equal(await accessEmail(req(), TEAM, AUD, certs, now), undefined);
	assert.equal(await accessEmail(req(await sign({ ...valid, aud: ["other"] })), TEAM, AUD, certs, now), undefined);
	assert.equal(await accessEmail(req(await sign({ ...valid, iss: "https://evil.cloudflareaccess.com" })), TEAM, AUD, certs, now), undefined);
	assert.equal(await accessEmail(req(await sign({ ...valid, exp: now / 1000 - 1 })), TEAM, AUD, certs, now), undefined);
	const [h, , s] = (await sign(valid)).split(".");
	const forged = `${h}.${b64url(JSON.stringify({ ...valid, email: "x@example.com" }))}.${s}`;
	assert.equal(await accessEmail(req(forged), TEAM, AUD, certs, now), undefined);
	assert.equal(await accessEmail(req(await sign(valid)), TEAM, "", certs, now), undefined, "no audience configured: closed");
});
