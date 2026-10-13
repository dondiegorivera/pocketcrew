// The git feed (src/git-feed.ts): new commits of the followed repos, read-only, secret-like content scrubbed, for the
// Ops agent. The cursor moves only after the upload.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPatch, DEV_REPOS, MAX_BODY_CHARS, scrub } from "../../src/git-feed.ts";
import { call, CURSORS } from "./lib.mjs";

const RS = "\x1e";
const US = "\x1f";
const FIRST_RUN_DAYS = 7;

/** Commits since `since` on every branch, each with the ref it was reached by, its files and its (cleaned) patch. */
function commitsSince(path, since) {
	const out = execFileSync("git", ["-C", path, "log", "--all", "--source", `--since=${since}`, `--format=${RS}%H${US}%P${US}%ct${US}%an${US}%S${US}%s${US}%b${US}`, "--numstat"], {
		encoding: "utf8",
		maxBuffer: 512 * 1024 * 1024,
	});
	const commits = [];
	for (const chunk of out.split(RS).slice(1)) {
		const [sha, parents, ct, author, ref, subject, body, rest] = chunk.split(US);
		const files = (rest ?? "").split("\n").filter((l) => /^(\d+|-)\t(\d+|-)\t/.test(l)).map((l) => {
			const [a, d, file] = l.split("\t");
			return { path: file, added: Number(a) || 0, deleted: Number(d) || 0 };
		});
		const merge = (parents ?? "").trim().split(/\s+/).length > 1;
		const patch = merge ? "(merge commit: no patch)" : cleanPatch(execFileSync("git", ["-C", path, "show", "--format=", "--no-color", sha], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
		commits.push({ sha, date: Number(ct) * 1000, author: scrub(author), subject: scrub(subject), body: scrub(body.trim()).slice(0, MAX_BODY_CHARS), ref: ref.replace(/^refs\/(heads|remotes)\//, ""), files, patch });
	}
	return commits;
}

function headsOf(path) {
	const out = execFileSync("git", ["-C", path, "for-each-ref", "refs/heads", "--sort=-committerdate", "--count=80", `--format=%(refname:short)${US}%(objectname)${US}%(committerdate:unix)${US}%(subject)`], { encoding: "utf8" });
	return out.split("\n").filter(Boolean).map((l) => {
		const [ref, sha, ct, subject] = l.split(US);
		return { ref, sha, date: Number(ct) * 1000, subject: scrub(subject ?? "") };
	});
}

/** New commits of each followed repo into the cloud feed. Read-only on the repos; the cursor moves only after upload. */
export async function syncGit() {
	mkdirSync(CURSORS, { recursive: true });
	for (const [name, r] of Object.entries(DEV_REPOS)) {
		if (!existsSync(r.path)) {
			console.error(`git feed ${name}: no repo at ${r.path}`);
			continue;
		}
		const cursor = join(CURSORS, `git-${name}.since`);
		const started = new Date();
		const since = existsSync(cursor) ? new Date(Date.parse(readFileSync(cursor, "utf8")) - 3_600_000) : new Date(started.getTime() - FIRST_RUN_DAYS * 86_400_000);
		const commits = commitsSince(r.path, since.toISOString());
		const heads = headsOf(r.path);
		for (let i = 0; i < Math.max(commits.length, 1); i += 100) await call("PUT", `/sync/git/${name}`, { commits: commits.slice(i, i + 100), heads: i === 0 ? heads : undefined });
		writeFileSync(cursor, started.toISOString());
		if (commits.length) console.log(`git feed ${name}: ${commits.length} commits`);
	}
}

