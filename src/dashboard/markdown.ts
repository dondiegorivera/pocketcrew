// Reports as readable HTML: a small Markdown subset (headings, lists, paragraphs, code, bold, links, tables). Every
// character is escaped first and only these constructs become tags, so text an agent copied from the web or from mail
// can never become markup. Links are http(s) only.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Inline: `code`, **bold**, [text](https://…) and bare https links, on already-escaped text. */
function inline(raw: string): string {
	const codes: string[] = [];
	let s = esc(raw).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
	s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" rel="noreferrer noopener" target="_blank">${t}</a>`);
	s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre: string, u: string) => `${pre}<a href="${u}" rel="noreferrer noopener" target="_blank">${u}</a>`);
	return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

export function markdown(text: string): string {
	const out: string[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let para: string[] = [];
	let list: { tag: "ul" | "ol"; items: string[] } | undefined;
	const flush = () => {
		if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
		para = [];
		if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
		list = undefined;
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (/^```/.test(line)) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
			out.push(`<pre>${esc(code.join("\n"))}</pre>`);
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(line)) {
			flush();
			const rows: string[] = [];
			for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(lines[i]!);
			i--;
			const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
			const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
			const [head, ...rest] = body;
			out.push(`<div class="scroll"><table><tr>${cells(head ?? "").map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table></div>`);
			continue;
		}
		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) {
			flush();
			const level = Math.min(heading[1]!.length + 1, 4); // the page has its own h1
			out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
			continue;
		}
		const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (bullet || numbered) {
			const tag = bullet ? "ul" : "ol";
			if (para.length || (list && list.tag !== tag)) flush();
			list ??= { tag, items: [] };
			list.items.push((bullet ?? numbered)![1]!);
			continue;
		}
		if (!line.trim()) {
			flush();
			continue;
		}
		if (list && /^\s{2,}\S/.test(line)) {
			list.items[list.items.length - 1] += ` ${line.trim()}`;
			continue;
		}
		if (list) flush();
		para.push(line);
	}
	flush();
	return out.join("\n");
}
