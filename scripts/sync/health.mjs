// The full run's report to the Director: its problems, plus a backup that is stale or failed (scripts/backup.sh).
// Only full runs report, so a stopped server shows up as silence in the briefing.
import { CONFIG } from "../../src/config.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { call, printError, problems } from "./lib.mjs";

export async function reportHealth() {
	const backup = join(homedir(), ".cache", `${CONFIG.name}-backup`, "last-ok");
	if (!existsSync(backup)) problems.push("backups are not set up yet: run scripts/backup-setup.sh once");
	else {
		const [at, ...failedRepos] = readFileSync(backup, "utf8").trim().split(/\s+/);
		const days = (Date.now() - Date.parse(at)) / 86_400_000;
		if (!(days < 2)) problems.push(`the last backup is ${Number.isFinite(days) ? Math.floor(days) : "?"} days old (~/.cache/${CONFIG.name}-backup.log)`);
		if (failedRepos.length) problems.push(`the last backup could not copy: ${failedRepos.join(", ")}`);
	}
	await call("POST", "/sync/health", { problems }).catch((err) => printError(`health report failed: ${err.message}`));
}
