// For tests only: which plugins this build has. A core test that uses a plugin's agents or tools names the plugins it
// needs and is skipped, with the reason, in a build without them; CI runs with every public plugin, so none goes untested.
import { FLEET } from "./fleet.ts";
import { plugins } from "./plugins.gen.ts";

/** A skip reason when one of these plugins is off in this build, else false (node:test's `skip` option). */
export function needs(...names: string[]): string | false {
	const on = new Set(plugins().map((p) => p.name));
	const off = names.filter((n) => !on.has(n));
	return off.length ? `needs the ${off.join(", ")} plugin${off.length > 1 ? "s" : ""}` : false;
}

/** The agents a private result may reach in this build: those without a way out that hold or may hold private data. */
export const PRIVATE_SAFE = ["calendar", "clerk", "closer", "mail", "notes", "ops", "outreach"].filter((a) => Object.hasOwn(FLEET, a));
