// The `reports` Worker: published pages for the phone, at pocketcrew.config.ts reportsUrl, behind Cloudflare Access.
// Deploy from this directory: npx cf deploy. It reads pages from the main Worker's Library object.
import { bindings, defineConfig } from "cf/config";
import { CONFIG } from "../../src/config.ts";

export default defineConfig({
	worker: {
		name: CONFIG.reportsWorker,
		compatibilityDate: "2026-10-01",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint: "../../src/site.ts",
		workersDev: true,
		previewUrls: false,
		observability: { logs: { enabled: true } },
		env: {
			Library: bindings.durableObject({ worker: CONFIG.name, exportName: "Library" }),
			// From the Access application that protects this hostname (Zero Trust → Access → Applications).
			// Identifiers, not secrets: the site still needs a token signed by the team's keys.
			ACCESS_TEAM_DOMAIN: bindings.text(CONFIG.reportsAccess.teamDomain),
			ACCESS_AUD: bindings.text(CONFIG.reportsAccess.aud),
		},
	},
});
