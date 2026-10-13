#!/usr/bin/env node
// The unit tests: core's (src/) and the enabled plugins' (pocketcrew.config.ts), run with node --test on fixed test
// settings (POCKETCREW_TEST, src/config.ts). A disabled plugin's tests stay out: its agents are not in this build.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { enabledPlugins, ROOT } from "./plugins.mjs";

const plugins = await enabledPlugins();
const files = [...globSync("src/**/*.test.ts", { cwd: ROOT }), ...plugins.flatMap((p) => globSync(`plugins/${p.name}/**/*.test.ts`, { cwd: ROOT }))];
const run = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: "inherit", env: { ...process.env, POCKETCREW_TEST: "1" } });
process.exit(run.status ?? 1);
