// Repo views (src/repo-views.ts): agents' queued writes applied one by one in the repo's working copy (~/<repo>),
// checked with the view's own scripts and committed, or reverted and reported; then the view uploaded again, redacted,
// whenever the repo or the view's definition changed.
import { CONFIG } from "../../src/config.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_VIEWS, viewFile, writableIn } from "../../src/repo-views.ts";
import { call, CURSORS, get, gitIn } from "./lib.mjs";

/** Applies one write in the working copy; returns the files it touched, for commit or revert. */
function applyWrite(dir, w) {
	const file = join(dir, w.path);
	const existed = existsSync(file);
	mkdirSync(join(file, ".."), { recursive: true });
	const before = existed ? readFileSync(file, "utf8") : "";
	writeFileSync(file, w.mode === "replace" ? w.content : `${before}${before && !before.endsWith("\n") ? "\n" : ""}${w.content}`);
	return { file, existed };
}

/** The view's checks, in the working copy; the first failure's output, or undefined when all pass. */
function failedCheck(dir, checks) {
	for (const cmd of checks ?? []) {
		try {
			execFileSync("/bin/sh", ["-c", cmd], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
		} catch (err) {
			return `${cmd} failed: ${`${err.stdout ?? ""}${err.stderr ?? ""}`.trim().slice(-1500)}`;
		}
	}
	return undefined;
}

/** Writes in, view out, for every repo view. */
/** `only`: those views (the minute run); all when undefined. */
export async function syncRepos(only) {
	for (const [name, v] of Object.entries(REPO_VIEWS)) {
		if (only && !only.includes(name)) continue;
		const dir = join(homedir(), v.repo);
		if (!existsSync(join(dir, ".git"))) {
			console.error(`repo view ${name}: no working copy at ${dir}`);
			continue;
		}
		// Others push to the same branch (the pipeline developer's clone): rebase our own unpushed commits onto theirs.
		try {
			gitIn(dir, "pull", "--rebase", "--quiet");
		} catch (err) {
			try {
				gitIn(dir, "rebase", "--abort");
			} catch {}
			console.error(`repo view ${name}: pull --rebase failed, skipped this run: ${err.message}`);
			continue;
		}
		const { writes } = await get(`/sync/repos/${name}/writes`);
		const results = [];
		let committed = 0;
		for (const w of writes) {
			if (!writableIn(v, w.path)) {
				results.push({ id: w.id, status: "failed", result: `${w.path} is not writable in ${name}` });
				continue;
			}
			const { file, existed } = applyWrite(dir, w);
			const failure = failedCheck(dir, v.check);
			if (failure) {
				gitIn(dir, "checkout", "--", "."); // the write and anything a check derived from it
				if (!existed) rmSync(file, { force: true });
				results.push({ id: w.id, status: "failed", result: failure });
				continue;
			}
			gitIn(dir, "add", "-A"); // the checks may update derived files (sync_portfolio_metadata.py)
			gitIn(dir, "commit", "--quiet", "-m", `${CONFIG.name} ${w.agent}: ${w.note || `${w.mode} ${w.path}`}`);
			results.push({ id: w.id, status: "committed", result: gitIn(dir, "rev-parse", "--short", "HEAD") });
			committed++;
		}
		if (committed || gitIn(dir, "status", "-sb").includes("ahead")) {
			try {
				gitIn(dir, "push", "--quiet", "origin", "HEAD");
			} catch (err) {
				console.error(`repo view ${name}: push failed, the next run rebases and retries: ${err.message}`);
			}
		}
		if (results.length) {
			await call("POST", "/sync/repos/acks", { results });
			console.log(`repo view ${name}: ${committed} of ${results.length} writes committed`);
		}
		// Upload when the repo or the view's definition changed since the last upload.
		const revision = gitIn(dir, "rev-parse", "HEAD");
		const stamp = createHash("sha256").update(revision + JSON.stringify(v)).digest("hex");
		const cursor = join(CURSORS, `${name}.view`);
		if (existsSync(cursor) && readFileSync(cursor, "utf8") === stamp) continue;
		const files = {};
		for (const path of gitIn(dir, "ls-files").split("\n").filter(Boolean)) {
			const text = viewFile(v, path, readFileSync(join(dir, path), "utf8"));
			if (text !== undefined) files[path] = text;
		}
		await call("PUT", `/sync/repos/${name}`, { files, revision });
		mkdirSync(CURSORS, { recursive: true });
		writeFileSync(cursor, stamp);
		console.log(`repo view ${name}: uploaded ${Object.keys(files).length} files at ${revision.slice(0, 8)}`);
	}
}

