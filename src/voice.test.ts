import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribe } from "./voice.ts";

const env = (out: object) => {
	const calls: { model: string; input: { audio: string } }[] = [];
	return { calls, env: { TELEGRAM_BOT_TOKEN: "T", AI: { run: async (model: string, input: { audio: string }) => (calls.push({ model, input }), out) } } as unknown as Env };
};

test("transcribe downloads the note, sends it to Whisper as base64 and returns the text", async (t) => {
	t.mock.method(globalThis, "fetch", async (url: string) =>
		String(url).includes("/getFile") ? Response.json({ ok: true, result: { file_path: "voice/1.oga" } }) : new Response(new Uint8Array([1, 2, 3])),
	);
	const { env: e, calls } = env({ text: " Dentist on Tuesday at three. " });
	assert.equal(await transcribe(e, { file_id: "f", duration: 4 }), "Dentist on Tuesday at three.");
	assert.equal(calls[0]!.input.audio, Buffer.from([1, 2, 3]).toString("base64"));
});

test("transcribe refuses long notes before downloading, and says so when no speech is found", async (t) => {
	const fetch = t.mock.method(globalThis, "fetch", async (url: string) =>
		String(url).includes("/getFile") ? Response.json({ ok: true, result: { file_path: "v" } }) : new Response(new Uint8Array([0])),
	);
	await assert.rejects(transcribe(env({}).env, { file_id: "f", duration: 900 }), /15 minutes long/);
	assert.equal(fetch.mock.callCount(), 0);
	await assert.rejects(transcribe(env({ text: "" }).env, { file_id: "f", duration: 3 }), /couldn't make out/);
});
