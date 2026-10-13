// Skills saved or installed in chat → skills/<name>/ on the code repo's main, in its own clone (~/<instance>-sync), with
// src/skills.gen.ts regenerated. Newer wins: a repo copy edited since the chat save is not overwritten.
import { CONFIG } from "../../src/config.ts";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isReferenceFileName, isSkillName, parseSkill, skillMarkdown } from "../../src/skill-format.ts";
import { get, gitIn } from "./lib.mjs";

const CODE = join(homedir(), `${CONFIG.name}-sync`); // a clone of the code's bare repo, for skill commits only

export async function syncSkills() {
	if (!existsSync(CODE)) return;
	const done = await commitSkills();
	if (done.length) console.log(`committed skills: ${done.join(", ")}`);
}

/** Skills from chat into the code's skills/, one commit when any changed. Returns the changed skill names. */
async function commitSkills() {
	const { skills } = await get("/library/skills");
	if (!skills.length) return [];
	gitIn(CODE, "pull", "--ff-only", "--quiet");
	for (const s of skills) {
		if (!isSkillName(s.name)) continue;
		const dir = join(CODE, "skills", s.name);
		// Newer wins, as in the catalog: a repo copy edited since the chat save is not overwritten.
		const inRepo = existsSync(join(dir, "SKILL.md")) ? parseSkill(readFileSync(join(dir, "SKILL.md"), "utf8")) : undefined;
		if (inRepo && typeof inRepo !== "string" && (inRepo.updated ?? 0) >= (s.updated ?? 0)) continue;
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), skillMarkdown(s));
		for (const [f, text] of Object.entries(s.files ?? {})) if (isReferenceFileName(f)) writeFileSync(join(dir, f), text);
	}
	const changed = [...new Set(gitIn(CODE, "status", "--porcelain", "skills").split("\n").filter(Boolean).map((l) => l.slice(3).split("/")[1]))];
	if (!changed.length) return [];
	// This same node binary: cron's PATH may find an older one, which cannot run the bundler's TypeScript import.
	execFileSync(process.execPath, [join(CODE, "scripts", "bundle-skills.mjs")], { stdio: ["ignore", "ignore", "inherit"] }); // keeps src/skills.gen.ts in step
	gitIn(CODE, "add", "skills", "src/skills.gen.ts");
	gitIn(CODE, "commit", "--quiet", "-m", `Skills from chat: ${changed.join(", ")}`);
	try {
		gitIn(CODE, "push", "--quiet", "origin", "HEAD:main");
	} catch {
		gitIn(CODE, "pull", "--rebase", "--quiet"); // someone pushed meanwhile
		gitIn(CODE, "push", "--quiet", "origin", "HEAD:main");
	}
	return changed;
}

