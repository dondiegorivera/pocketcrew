// Role files (roles/<agent>.md): each standing agent's contract, always part of its instructions. One fixed shape, so
// every agent's behaviour is written down the same way: a title line, then these sections in this order. No
// dependencies, so scripts/bundle-roles.mjs runs on plain node. Developer-only: they change in the repo, never in chat.

export const ROLE_SECTIONS = ["Purpose", "Owns", "Does not", "Inputs", "Output", "Hand-offs", "Ask when", "Quality bar"] as const;
export type RoleSection = (typeof ROLE_SECTIONS)[number];

/** Always-on text is paid for on every turn: a role stays within this many words. */
export const ROLE_MAX_WORDS = 500;

export type Role = { title: string; sections: Record<RoleSection, string> };

/** A role file parsed, or why it does not fit the shape. */
export function parseRole(markdown: string): Role | string {
	const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim();
	if (!title) return "A role starts with a # title line.";
	const parts = markdown.split(/^## /m).slice(1).map((p) => {
		const nl = p.indexOf("\n");
		return [p.slice(0, nl === -1 ? undefined : nl).trim(), nl === -1 ? "" : p.slice(nl + 1).trim()] as const;
	});
	const names = parts.map(([n]) => n);
	if (names.join("|") !== ROLE_SECTIONS.join("|")) return `Sections must be, in order: ${ROLE_SECTIONS.join(", ")}. Found: ${names.join(", ") || "none"}.`;
	const empty = parts.filter(([, body]) => !body).map(([n]) => n);
	if (empty.length) return `Empty sections: ${empty.join(", ")}.`;
	const words = markdown.split(/\s+/).filter(Boolean).length;
	if (words > ROLE_MAX_WORDS) return `${words} words; keep a role within ${ROLE_MAX_WORDS} and move procedures into skills.`;
	return { title, sections: Object.fromEntries(parts) as Record<RoleSection, string> };
}

/** The role's boundaries in one line, for the Lead's dispatch tool: the first points of "Does not", shortened. */
export function boundaries(role: Role, max = 3): string {
	return role.sections["Does not"]
		.split("\n")
		.map((l) => l.replace(/^[-*\d.]+\s*/, "").split(/[:;]|\.(?=\s|$)/)[0]!.trim())
		.filter(Boolean)
		.slice(0, max)
		.join("; ");
}
