// Text files the operator sends (a spec, a skill, notes): read and passed on as part of the message. Other files are
// declined, as before; the fleet reads no PDFs or images yet.
import type { Bot, Document } from "./telegram.ts";

export const MAX_TEXT_FILE_BYTES = 200_000;
const TEXT_NAME = /\.(md|markdown|txt|csv|json|ya?ml|html?)$/i;

export const isTextDocument = (d: Document) => (d.mime_type?.startsWith("text/") ?? false) || TEXT_NAME.test(d.file_name ?? "");

/** The file as text, or a thrown Error whose message is fit to show the operator. */
export async function readTextDocument(b: Bot, d: Document): Promise<string> {
	if (!isTextDocument(d)) throw new Error("I can read text files (.md, .txt, .csv, .json, .yaml, .html), not this kind yet.");
	if ((d.file_size ?? 0) > MAX_TEXT_FILE_BYTES) throw new Error(`That file is over ${MAX_TEXT_FILE_BYTES / 1000} KB; send a shorter one.`);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(await b.download(d.file_id));
	if (text.length > MAX_TEXT_FILE_BYTES) throw new Error(`That file is over ${MAX_TEXT_FILE_BYTES / 1000} KB; send a shorter one.`);
	return text;
}

/** The message an agent gets: the operator's caption, then the file, clearly delimited as one. */
export const withFile = (caption: string | undefined, name: string | undefined, text: string) =>
	`${caption?.trim() || "(a file, no message)"}\n\n[attached file ${name ?? "unnamed"}]\n${text}\n[end of file]`;
