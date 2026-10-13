#!/usr/bin/env node
// Git over HTTPS for the operator's notes (<gitRoot>/notes.git), so Obsidian's Git plugin on the phone can pull
// and push. Smart HTTP through git's own http-backend, for that one repo only, behind a password the operator set with
// `npm run notes-password` (only its scrypt hash is on disk). It listens on localhost; `tailscale serve` puts HTTPS in
// front of it on the tailnet, so nothing is reachable from the internet.
//   Unit: notes-git.service beside this file (installed as <name>-notes-git) · Logs: journalctl --user -u <name>-notes-git
//   URL for Obsidian: https://<this machine's tailnet name>:8443/notes.git
import { CONFIG } from "../../../src/config.ts";
import { spawn } from "node:child_process";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = CONFIG.gitRoot;
const REPO = "notes.git";
const PORT = Number(process.env.POCKETCREW_NOTES_GIT_PORT ?? 8342);
export const PASS_FILE = join(homedir(), ".config", CONFIG.name, "notes-git.pass");
const MAX_FAILS_PER_MINUTE = 5;

/** The stored `salt:hash` (hex, scrypt) against a password. */
export function passwordMatches(stored, password) {
	const [salt, hash] = stored.trim().split(":");
	if (!salt || !hash) return false;
	const want = Buffer.from(hash, "hex");
	const got = scryptSync(password, Buffer.from(salt, "hex"), want.length);
	return timingSafeEqual(want, got);
}

/** The path inside the repo for a request, or undefined when it is not for the notes repo. */
export function repoPath(url) {
	const path = new URL(url, "http://x").pathname;
	return path === `/${REPO}` || path.startsWith(`/${REPO}/`) ? path : undefined;
}

const fails = [];
const tooMany = () => {
	const now = Date.now();
	while (fails.length && fails[0] < now - 60_000) fails.shift();
	return fails.length >= MAX_FAILS_PER_MINUTE;
};

function authorized(req) {
	let stored;
	try {
		stored = readFileSync(PASS_FILE, "utf8");
	} catch {
		return false; // no password set yet: nobody gets in
	}
	const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? "");
	if (!m) return false;
	const decoded = Buffer.from(m[1], "base64").toString("utf8");
	const password = decoded.slice(decoded.indexOf(":") + 1);
	return passwordMatches(stored, password);
}

function serve(req, res) {
	const path = repoPath(req.url);
	if (!path) return void res.writeHead(404).end("not found\n");
	if (tooMany()) return void res.writeHead(429, { "retry-after": "60" }).end("too many failed sign-ins; wait a minute\n");
	if (!authorized(req)) {
		if (req.headers.authorization) fails.push(Date.now());
		return void res.writeHead(401, { "www-authenticate": 'Basic realm="notes"' }).end("sign in\n");
	}
	const url = new URL(req.url, "http://x");
	const cgi = spawn("git", ["http-backend"], {
		env: {
			PATH: process.env.PATH,
			GIT_PROJECT_ROOT: ROOT,
			GIT_HTTP_EXPORT_ALL: "1",
			REMOTE_USER: "operator", // lets receive-pack (push) run
			REQUEST_METHOD: req.method,
			PATH_INFO: path,
			QUERY_STRING: url.search.slice(1),
			CONTENT_TYPE: req.headers["content-type"] ?? "",
			...(req.headers["content-length"] ? { CONTENT_LENGTH: req.headers["content-length"] } : {}),
			...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: req.headers["content-encoding"] } : {}),
			...(req.headers["git-protocol"] ? { GIT_PROTOCOL: req.headers["git-protocol"] } : {}),
		},
	});
	req.pipe(cgi.stdin);
	// CGI output: headers, a blank line, then the body as it comes.
	let head = Buffer.alloc(0);
	let started = false;
	cgi.stdout.on("data", (chunk) => {
		if (started) return void res.write(chunk);
		head = Buffer.concat([head, chunk]);
		const end = head.indexOf("\r\n\r\n") >= 0 ? head.indexOf("\r\n\r\n") : head.indexOf("\n\n");
		if (end < 0) return;
		const sep = head[end] === 13 ? 4 : 2;
		let status = 200;
		const headers = {};
		for (const line of head.subarray(0, end).toString("utf8").split(/\r?\n/)) {
			const i = line.indexOf(":");
			if (i < 0) continue;
			const [k, v] = [line.slice(0, i).trim(), line.slice(i + 1).trim()];
			if (k.toLowerCase() === "status") status = Number.parseInt(v, 10) || 200;
			else headers[k] = v;
		}
		res.writeHead(status, headers);
		started = true;
		res.write(head.subarray(end + sep));
	});
	cgi.stderr.on("data", (d) => process.stderr.write(d));
	cgi.on("close", () => {
		if (!started) res.writeHead(500).end("git failed\n");
		else res.end();
	});
}

export function listen() {
	createServer(serve).listen(PORT, "127.0.0.1", () => console.log(`notes git on 127.0.0.1:${PORT}/${REPO}`));
}

if (import.meta.url === `file://${process.argv[1]}`) listen();
