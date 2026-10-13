// Shared by the sync's steps: the Worker's address and token, HTTP calls, git, the cursor folder, and the run's
// problems (every error a step prints), which the full run reports to the Director.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../../src/config.ts";

export const BASE = process.env.POCKETCREW_URL ?? CONFIG.url;
const TOKEN = readFileSync(join(homedir(), ".config", CONFIG.name, "library-export-token"), "utf8").trim();
export const CURSORS = join(homedir(), ".cache", `${CONFIG.name}-sync`);

export const gitIn = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

// What went wrong this run, for the Director's health line: every error the run prints.
export const problems = [];
export const printError = console.error.bind(console);
console.error = (...args) => {
	problems.push(args.map(String).join(" ").slice(0, 300));
	printError(...args);
};

export async function call(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return res.json();
}
export const get = (path) => call("GET", path);

