#!/usr/bin/env node
// npm run setup, the settings step: asks for what this instance needs to know and writes pocketcrew.config.ts.
// Every answer has a default (Enter keeps it): the current setting, or a guess such as this machine's time zone.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CONFIG } from "../src/config.ts";

const ROOT = join(import.meta.dirname, "..");
let rl;
let lines;
// Lines from an iterator, not rl.question(): piped answers (a script, a test) arrive before a question would ask.
const ask = async (q, def) => {
	process.stdout.write(`${q}${def !== undefined && def !== "" ? ` [${def}]` : ""}: `);
	const { value, done } = await lines.next();
	if (done) throw new Error("no more answers");
	if (!process.stdin.isTTY) console.log(value);
	return value.trim() || def;
};
const yes = async (q, def) => /^y/i.test(await ask(`${q} (y/n)`, def ? "y" : "n"));

/** The subdomain in https://<worker>.<subdomain>.workers.dev, or undefined for another address. */
export const subdomainOf = (url) => /^https:\/\/[^.]+\.([^.]+)\.workers\.dev\/?$/.exec(url ?? "")?.[1];

/** The config file's text for these settings. */
export function configText(c) {
	return [
		"// The owner's settings for this pocketcrew instance; src/config.ts lists every one with its default. Written by",
		"// npm run setup; edit freely. Plugins listed here are compiled in, everything else in plugins/ stays out.",
		'import type { Config } from "./src/config.ts";',
		"",
		`export default ${JSON.stringify(c, null, "\t")} satisfies Partial<Config>;`,
		"",
	].join("\n");
}

async function main() {
	rl = createInterface({ input: process.stdin, terminal: false });
	lines = rl[Symbol.asyncIterator]();
	console.log("\nSettings (pocketcrew.config.ts). Enter keeps the value in brackets.\n");
	const zone = await ask("Your time zone (IANA name)", CONFIG.timeZone !== "UTC" ? CONFIG.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone);
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
	} catch {
		throw new Error(`"${zone}" is not a time zone name, such as Europe/Berlin or America/New_York`);
	}
	console.log("\nYour workers.dev subdomain: Cloudflare dashboard → Workers & Pages, shown as <name>.workers.dev.");
	console.log("No subdomain yet? Pick one now; the first deploy asks for it, so type the same there.");
	const sub = await ask("Subdomain", subdomainOf(CONFIG.url) === "example" ? undefined : subdomainOf(CONFIG.url));
	if (!/^[a-z0-9-]+$/.test(sub ?? "")) throw new Error("a subdomain is lowercase letters, digits and hyphens");

	const available = readdirSync(join(ROOT, "plugins")).filter((p) => existsSync(join(ROOT, "plugins", p, "plugin.ts")));
	console.log(`\nPlugins. Core alone is the Lead; each plugin adds agents and commands (docs: plugins/<name>/skill.md).`);
	const about = { google: "Mail, Calendar, Clerk: Gmail, Calendar and Drive (needs a Google OAuth client)", web: "Research and Radar: web search and reading", notes: "Notes kept as Markdown in a git repo, for Obsidian (needs the home server)", ops: "Ops: your repos' commits and your sites' traffic (needs the home server for git)" };
	const plugins = [];
	for (const p of available) if (await yes(`  ${p}${about[p] ? `: ${about[p]}` : ""}`, CONFIG.plugins.includes(p) || !CONFIG.plugins.length)) plugins.push(p);

	console.log("\nBudget: what the fleet may spend on your Anthropic key, paced evenly until the end date.");
	const usd = Number(await ask("  Amount in USD", String(CONFIG.credit.usd || 50)));
	const until = await ask("  Until (YYYY-MM-DD)", CONFIG.credit.expires.slice(0, 10) !== "1970-01-01" ? CONFIG.credit.expires.slice(0, 10) : new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
	if (!(usd > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("the amount is a number above 0 and the date YYYY-MM-DD");

	const next = {
		...CONFIG,
		plugins,
		timeZone: zone,
		credit: { usd, asOf: new Date().toISOString().replace(/\.\d+Z$/, "Z"), expires: `${until}T00:00:00Z` },
		url: `https://${CONFIG.name}.${sub}.workers.dev`,
		reportsUrl: `https://${CONFIG.reportsWorker}.${sub}.workers.dev`,
	};
	writeFileSync(join(ROOT, "pocketcrew.config.ts"), configText(next));
	console.log("\n✓ pocketcrew.config.ts written");
}

if (process.argv[1] === import.meta.filename) {
	try {
		await main();
	} catch (err) {
		console.error(`\n✗ ${err.message}`);
		process.exitCode = 1;
	} finally {
		rl?.close();
	}
}
