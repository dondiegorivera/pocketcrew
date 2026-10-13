#!/usr/bin/env node
// `npm run smoke`, on the server: a read-only check of the live system, the acceptance list's automatic part
// (docs/acceptance.md). It changes nothing: it reads the Worker's diag endpoints, the sync and backup state on disk,
// the deploy log and the cron table, and prints one line per check. Exit code 1 when something is wrong.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.ts";

const BASE = process.env.POCKETCREW_URL ?? CONFIG.url;
const TOKEN_FILE = join(homedir(), ".config", CONFIG.name, "library-export-token");
const HOUR = 3_600_000;
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: ok === true ? "ok" : ok === "warn" ? "warn" : "FAIL", detail });

async function get(path, auth = true) {
	const res = await fetch(`${BASE}${path}`, {
		headers: auth ? { authorization: `Bearer ${readFileSync(TOKEN_FILE, "utf8").trim()}` } : {},
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
	return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

const tail = (file, n = 400) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").slice(-n) : []);
const ageOf = (ms) => (ms < HOUR ? `${Math.round(ms / 60_000)} min` : `${(ms / HOUR).toFixed(1)} h`);

// The Worker and the Director
try {
	await get("/", false);
	check("worker answers", true);
} catch (err) {
	check("worker answers", false, err.message);
}
try {
	const h = await get("/sync/diag/health");
	const now = h.now;
	check("director ticks every 15 min", h.lastTick > 0 && now - h.lastTick < 40 * 60_000 ? true : h.lastTick === 0 ? "warn" : false, h.lastTick ? `last ${ageOf(now - h.lastTick)} ago` : "no tick recorded yet (new after this deploy)");
	check("server sync reports", now - h.syncSeen < 2 * HOUR, h.syncSeen ? `last ${ageOf(now - h.syncSeen)} ago` : "never");
	check("sync has no problems", h.syncProblems.length === 0 ? true : "warn", h.syncProblems.join(" | "));
	check("no stuck jobs", h.jobs.stuck === 0, `${h.jobs.running} running, ${h.jobs.queued} queued, ${h.jobs.stuck} running over 3 h`);
	check("few failed jobs today", h.jobs.failedToday <= 2 ? true : "warn", `${h.jobs.failedToday} in 24 h`);
	check("every routine is scheduled", h.scheduledRoutines >= h.routines, `${h.scheduledRoutines} schedules for ${h.routines} routines`);
	check("google connected, all permissions", h.google?.connected && !(h.google.missing ?? []).length ? true : h.google?.connected ? "warn" : false, h.google ? (h.google.missing?.length ? `missing ${h.google.missing.length}` : h.google.connected ? "" : "not connected") : "no status");
	if ((h.plugins ?? []).includes("google")) check("mail watch on", h.mailWatch ? true : "warn");
	check("budget not exhausted", !h.budget.expired && h.budget.leftUsd > 1, `$${h.budget.leftUsd.toFixed(2)} left, $${h.budget.spentTodayUsd.toFixed(2)} of $${h.budget.todayUsd.toFixed(2)} today, ${h.budget.daysLeft.toFixed(1)} days`);
	check("credit expiry more than a week away", h.budget.daysLeft > 7 ? true : "warn", `${h.budget.daysLeft.toFixed(1)} days`);
	check("topics set up", h.topics >= 1, `${h.topics} topics`);
	const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timeZone }).format(new Date(now));
	if (hour >= 11) check("briefing sent today", h.briefingDay === today ? true : "warn", h.briefingDay ?? "never");
	if (hour >= 19) check("inbox line sent today", h.inboxDay === today ? true : "warn", h.inboxDay ?? "never");
	check("plugins loaded", Array.isArray(h.plugins), (h.plugins ?? []).join(", ") || "none");
} catch (err) {
	check("director health", false, err.message);
}

// The server
const sync = tail(join(homedir(), ".cache", `${CONFIG.name}-sync.log`));
const lastFail = sync.filter((l) => /sync failed/.test(l)).at(-1);
check("sync log has no recent failure", !lastFail || Date.now() - Date.parse(lastFail.slice(0, 24)) > HOUR ? true : "warn", lastFail ?? "");
const stamp = join(homedir(), ".cache", `${CONFIG.name}-backup`, "last-ok");
if (existsSync(stamp)) {
	const [at, ...failed] = readFileSync(stamp, "utf8").trim().split(/\s+/);
	check("backup within 2 days", Date.now() - Date.parse(at) < 2 * 24 * HOUR, `${ageOf(Date.now() - Date.parse(at))} ago${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
} else check("backup within 2 days", false, "no backup yet");
const deploy = tail(join(homedir(), ".cache", `${CONFIG.name}-deploy`, "deploy.log"), 5).filter(Boolean).at(-1) ?? "";
check("last deploy succeeded", /deployed$/.test(deploy), deploy);
let cron = "";
try {
	cron = execFileSync("crontab", ["-l"], { encoding: "utf8" });
} catch {}
check("cron: full sync", /\*\/15 .*scripts\/sync\.mjs/.test(cron));
check("cron: minute sync", /^\* \* \* \* \* .*sync\.mjs --views/m.test(cron));
check("cron: nightly backup", /scripts\/backup\.sh/.test(cron));
const notesBare = `${CONFIG.gitRoot}/notes.git`;
let notesAt = 0;
try {
	notesAt = Number(execFileSync("git", ["-C", notesBare, "log", "-1", "--format=%ct", "main"], { encoding: "utf8" }).trim()) * 1000;
} catch {}
check("notes repo", notesAt ? true : "warn", notesAt ? `last commit ${ageOf(Date.now() - notesAt)} ago` : "not set up");

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok === "ok" ? "✓" : r.ok === "warn" ? "!" : "✗"} ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => r.ok === "FAIL").length;
console.log(`\n${results.length - failed} of ${results.length} fine${failed ? `, ${failed} failing` : ""}.`);
process.exit(failed ? 1 : 0);
