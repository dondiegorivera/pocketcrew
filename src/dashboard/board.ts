// The kanban board, docs/board.md, in a common kanban format: six fixed columns as `## ` headings, one card
// per line: `- [C-001] Title — owner: … · sprint: … · updated: YYYY-MM-DD · note: …`. Pure, for the dashboard.

export const COLUMNS = ["Waiting on operator", "In progress", "Review", "Next", "Backlog", "Done"] as const;
export type Column = (typeof COLUMNS)[number];

export type Card = { id: string; title: string; owner?: string; sprint?: string; updated?: string; note?: string };
export type Board = { columns: Record<Column, Card[]>; problems: string[] };

const FIELDS = ["owner", "sprint", "updated", "note"] as const;

/** One card line, or undefined when the line is not a card. Fields after the title are optional and in any order. */
export function parseCard(line: string): Card | undefined {
	const m = /^- \[([A-Z]+-\d+)\]\s+(.*)$/.exec(line.trim());
	if (!m) return undefined;
	const [title, ...rest] = m[2]!.split(" — ");
	const card: Card = { id: m[1]!, title: title!.trim() };
	// The note is free text and may hold " · " itself: everything after "note:" belongs to it.
	const tail = rest.join(" — ");
	const noteAt = tail.search(/(?:^|·\s*)note:/);
	const head = noteAt === -1 ? tail : tail.slice(0, noteAt);
	if (noteAt !== -1) card.note = tail.slice(noteAt).replace(/^·?\s*note:\s*/, "").trim();
	for (const part of head.split("·")) {
		const f = /^\s*(\w+):\s*(.*?)\s*$/.exec(part);
		if (f && (FIELDS as readonly string[]).includes(f[1]!) && f[1] !== "note") card[f[1] as Exclude<(typeof FIELDS)[number], "note">] = f[2]!;
	}
	return card;
}

export function parseBoard(markdown: string): Board {
	const columns = Object.fromEntries(COLUMNS.map((c) => [c, [] as Card[]])) as Record<Column, Card[]>;
	const problems: string[] = [];
	let current: Column | undefined;
	for (const line of markdown.split("\n")) {
		const heading = /^## (.+?)\s*$/.exec(line);
		if (heading) {
			current = (COLUMNS as readonly string[]).includes(heading[1]!) ? (heading[1] as Column) : undefined;
			if (!current) problems.push(`unknown column "${heading[1]}"`);
			continue;
		}
		const card = parseCard(line);
		if (!card) continue;
		if (current) columns[current].push(card);
		else problems.push(`${card.id} sits outside the six columns`);
	}
	return { columns, problems };
}
