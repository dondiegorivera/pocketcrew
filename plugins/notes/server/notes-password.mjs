#!/usr/bin/env node
// Operator only (`npm run notes-password`): sets the password Obsidian uses for the notes repo. Typed at the keyboard,
// never shown, never in argv; only a scrypt hash is written (~/.config/<name>/notes-git.pass, mode 600).
import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PASS_FILE } from "./notes-git-server.mjs";

function ask(prompt) {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		if (!stdin.isTTY) {
			console.error("Run this in a terminal: the password is read from the keyboard.");
			process.exit(1);
		}
		process.stdout.write(prompt);
		stdin.setRawMode(true);
		stdin.resume();
		let value = "";
		const onData = (buf) => {
			for (const ch of buf.toString("utf8")) {
				if (ch === "\r" || ch === "\n") {
					stdin.setRawMode(false);
					stdin.pause();
					stdin.off("data", onData);
					process.stdout.write("\n");
					return resolve(value);
				}
				if (ch === "\u0003") process.exit(130);
				if (ch === "\u007f") value = value.slice(0, -1);
				else value += ch;
			}
		};
		stdin.on("data", onData);
	});
}

const first = await ask("New password for the notes repo (at least 12 characters): ");
if (first.length < 12) {
	console.error("Too short; nothing changed.");
	process.exit(1);
}
if ((await ask("Again: ")) !== first) {
	console.error("They differ; nothing changed.");
	process.exit(1);
}
const salt = randomBytes(16);
mkdirSync(dirname(PASS_FILE), { recursive: true });
writeFileSync(PASS_FILE, `${salt.toString("hex")}:${scryptSync(first, salt, 32).toString("hex")}\n`, { mode: 0o600 });
console.log("Saved. In Obsidian's Git plugin: username operator (any name works), this password.");
