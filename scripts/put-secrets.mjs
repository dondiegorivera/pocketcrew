#!/usr/bin/env node
// Writes secrets where the Worker reads them: into the account's Secrets Store when STORE_ID is set (src/secrets.ts),
// else as Worker secrets through a deploy. Values pass through RAM-only files and never through a command line.
//
// Usage: node scripts/put-secrets.mjs <file with {"NAME": "value", ...}> [--deploy]
//   --deploy: deploy afterwards (always, without a store: that is how Worker secrets are set)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPTIONAL_SECRETS, SECRET_NAMES, STORE_ID, STORE_PREFIX } from "../src/secrets.ts";

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error("usage: put-secrets.mjs <json file> [--deploy]");
const values = JSON.parse(readFileSync(file, "utf8"));
const names = Object.keys(values).filter((n) => values[n]);
const unknown = names.filter((n) => !SECRET_NAMES.includes(n));
if (unknown.length) throw new Error(`unknown secret names: ${unknown.join(", ")}`);

const root = join(import.meta.dirname, "..");
const cf = (...args) => execFileSync("npx", ["cf", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const deploy = (...args) => {
	execFileSync(process.execPath, [join(root, "scripts", "bundle-skills.mjs")], { stdio: "ignore" });
	execFileSync("npx", ["cf", "deploy", ...args], { cwd: root, stdio: ["inherit", "ignore", "inherit"] });
};

if (!STORE_ID) {
	deploy("--secrets-file", file);
	console.log(`Worker secrets set: ${names.join(", ") || "none"}`);
	process.exit(0);
}

const listed = JSON.parse(cf("secrets-store", "secrets", "list", "--store-id", STORE_ID));
const ids = new Map((Array.isArray(listed) ? listed : (listed.result ?? [])).map((s) => [s.name, s.id]));
const tmp = mkdtempSync("/dev/shm/secrets-"); // tmpfs: RAM only, this user only
try {
	for (const name of names) {
		const body = join(tmp, "body.json");
		const stored = `${STORE_PREFIX}${name}`;
		const id = ids.get(stored);
		writeFileSync(body, JSON.stringify(id ? { value: values[name], scopes: ["workers"] } : [{ name: stored, value: values[name], scopes: ["workers"] }]), { mode: 0o600 });
		if (id) cf("secrets-store", "secrets", "edit", id, "--store-id", STORE_ID, "--body", `@${body}`);
		else cf("secrets-store", "secrets", "create", STORE_ID, "--body", `@${body}`);
		rmSync(body);
		console.log(`${id ? "updated" : "added"} ${stored}`);
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
if (flags.includes("--deploy")) {
	// A store binding to a missing secret fails the whole deploy: say what is missing instead.
	const have = new Set(JSON.parse(cf("secrets-store", "secrets", "list", "--store-id", STORE_ID)).map((s) => s.name));
	const missing = SECRET_NAMES.filter((n) => !have.has(`${STORE_PREFIX}${n}`));
	const required = missing.filter((n) => !OPTIONAL_SECRETS.includes(n));
	if (required.length) {
		console.error(`Not deployed: the store still needs ${required.join(", ")}. Run npm run secrets again and enter them.`);
		process.exit(1);
	}
	// Optional ones may come later: a placeholder keeps the binding valid, and the feature says it is not set up.
	for (const name of missing) {
		const body = join(mkdtempSync("/dev/shm/secrets-"), "body.json");
		writeFileSync(body, JSON.stringify([{ name: `${STORE_PREFIX}${name}`, value: "unset", scopes: ["workers"] }]), { mode: 0o600 });
		cf("secrets-store", "secrets", "create", STORE_ID, "--body", `@${body}`);
		rmSync(join(body, ".."), { recursive: true, force: true });
	}
	deploy();
	console.log("Deployed with the store's secrets.");
}
