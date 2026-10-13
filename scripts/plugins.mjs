// The enabled plugins, from pocketcrew.config.ts: their names and folders, checked to exist. Shared by the bundlers and
// the server's sync, all plain node.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");

/** [{ name, dir }] in config order; exits with a message when one is missing. */
export async function enabledPlugins() {
	const { default: config } = await import(join(ROOT, "pocketcrew.config.ts"));
	// POCKETCREW_PLUGINS=a,b (CI's plugin matrix; "none" for core alone) builds with those instead.
	const env = process.env.POCKETCREW_PLUGINS;
	const names = env !== undefined ? env.split(",").filter((n) => n && n !== "none") : (config.plugins ?? []);
	const missing = names.filter((n) => !existsSync(join(ROOT, "plugins", n, "plugin.ts")));
	if (missing.length) {
		console.error(`pocketcrew.config.ts enables plugins that are not in plugins/: ${missing.join(", ")}`);
		process.exit(1);
	}
	return names.map((name) => ({ name, dir: join(ROOT, "plugins", name) }));
}
