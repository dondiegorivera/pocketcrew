#!/usr/bin/env node
// One owner setting (src/config.ts, from pocketcrew.config.ts) for the shell scripts: node scripts/config.mjs gitRoot
import { CONFIG } from "../src/config.ts";

const value = CONFIG[process.argv[2]];
if (value === undefined) {
	console.error(`no setting "${process.argv[2]}" in src/config.ts`);
	process.exit(1);
}
console.log(typeof value === "object" ? JSON.stringify(value) : String(value));
