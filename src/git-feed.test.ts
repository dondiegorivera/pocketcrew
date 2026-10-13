import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPatch, type Commit, GitStore, isSecretFile, MAX_PATCH_CHARS, scrub } from "./git-feed.ts";
import { memorySql } from "./test-sql.ts";

test("secrets never leave the server: known token shapes, key=value secrets, private keys, secret files", () => {
	const text = "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuv\ntoken: ghp_abcdefghijklmnopqrstuvwxyz123456\nbot 1234567890:AAabcdefghijklmnopqrstuvwxyz0123456789\npassword = 'hunter2hunter2hunter2'\nplain words stay";
	const out = scrub(text);
	assert.ok(!/sk-ant-api03|ghp_abc|AAabcdef|hunter2/.test(out), out);
	assert.match(out, /plain words stay/);
	assert.match(scrub("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----"), /^\[redacted\]$/);
	for (const f of [".env", "app/.env.production", "certs/server.pem", "id_ed25519", "config/secrets.yaml", "credentials.json"]) assert.ok(isSecretFile(f), f);
	for (const f of ["src/env.ts", "README.md", "docs/secrets-policy.md"]) assert.ok(!isSecretFile(f), f);
	const patch = "diff --git a/.env b/.env\n+KEY=abc\ndiff --git a/src/a.ts b/src/a.ts\n+const x = 1;\n";
	const cleaned = cleanPatch(patch);
	assert.ok(!cleaned.includes("KEY=abc"));
	assert.match(cleaned, /\.env b\/\.env\n\[content not uploaded/);
	assert.match(cleaned, /const x = 1/);
	assert.match(cleanPatch("x".repeat(MAX_PATCH_CHARS + 10)), /\[patch cut/);
});

const commit = (sha: string, date: number, over: Partial<Commit> = {}): Commit => ({ sha, date, author: "agent-lead", subject: `change ${sha}`, body: "", ref: "main", files: [{ path: "src/a.ts", added: 3, deleted: 1 }], patch: "diff", ...over });

test("the feed keeps commits once, filters them, shows one in full, and prunes the old", () => {
	const now = Date.UTC(2026, 9, 10);
	const git = new GitStore(memorySql());
	git.upload("mesh", [commit("aaa1111111", now - 3_600_000), commit("bbb2222222", now - 7_200_000, { author: "dev", ref: "feat/x", files: [{ path: "docs/plan.md", added: 10, deleted: 0 }] })], [{ ref: "feat/x", sha: "bbb2222222", date: now - 7_200_000, subject: "plan" }], now);
	git.upload("mesh", [commit("aaa1111111", now - 3_600_000)], undefined, now);
	assert.equal(git.log("mesh", {}).split("\n").length, 2, "a repeated upload adds nothing");
	assert.match(git.log("mesh", { author: "dev" }), /^bbb222222 .* dev · feat\/x · change bbb2222222 \(1 files, \+10 −0\)$/);
	assert.match(git.log("mesh", { path: "docs/" }), /bbb222222/);
	assert.match(git.log("mesh", { since: now - 5_000_000 }), /^aaa111111/);
	assert.match(git.show("mesh", "aaa1111"), /change aaa1111111[\s\S]*src\/a\.ts \+3 −1/);
	assert.match(git.branches("mesh", 14, now), /^feat\/x · /);
	assert.match(git.repos(now), /^mesh: 2 commits in 7 days, 1 branches active/);
	git.upload("mesh", [commit("ccc3333333", now - 200 * 86_400_000)], undefined, now);
	assert.match(git.show("mesh", "ccc3333"), /No commit/, "older than the kept window");
});
