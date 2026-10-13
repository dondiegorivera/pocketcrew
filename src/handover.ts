// Handing text to the operator to paste somewhere the fleet cannot send: a LinkedIn note, a contact form. Each text
// arrives as its own Telegram message after a one-line label, so on the phone it is one long-press to copy.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";

export const MAX_COPY_CHARS = 3_500;

export const handoverKit = (send: (label: string, text: string) => Promise<void>): Extension =>
	defineExtension({
		name: "handover",
		tools: [
			defineTool({
				name: "send_copy",
				description:
					"Send the operator one text to paste and send themselves, such as a LinkedIn connection note or message, or a contact-form " +
					"text. It arrives as its own message, alone, so it copies cleanly. Put where it goes in the label. Nothing is sent to anyone else.",
				parameters: Type.Object({
					label: Type.String({ description: "One line: channel, recipient and what this text is, e.g. LinkedIn note to Jane Doe (Ory), 182 characters" }),
					text: Type.String({ description: "Exactly the text to paste, nothing around it" }),
				}),
				replay: "safe",
				execute: async ({ label, text }) => {
					if (text.length > MAX_COPY_CHARS) return { content: [{ type: "text", text: `Too long for one message (${text.length} characters).` }], isError: true };
					await send(label.replace(/\s+/g, " ").slice(0, 300), text.trim());
					return { content: [{ type: "text", text: "Sent to the operator to copy." }] };
				},
			}),
		],
	});
