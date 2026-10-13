// A time-critical find, said at once instead of at the end of the job: a dataset that may be taken down, a release that
// changes a plan. One message in the agent's topic, at most once a day per agent (the operator's rule), so it stays a
// signal. Everything else waits for the report.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";

export const MAX_ALERT_CHARS = 1_000;

/** `send` delivers and enforces the daily limit; it answers why it refused, or undefined when sent. */
export const alertKit = (send: (text: string) => Promise<string | undefined>): Extension =>
	defineExtension({
		name: "alert",
		tools: [
			defineTool({
				name: "alert_operator",
				description:
					"Tell the operator NOW about one find that cannot wait for the report: it may disappear (a dataset or model that could be taken " +
					"down), or it directly hits a top pain point of a project. At most once a day; everything else goes in the report. " +
					"Say what it is, why it matters for which project, what to do now, and the link.",
				parameters: Type.Object({ text: Type.String({ description: `At most ${MAX_ALERT_CHARS} characters, plain text` }) }),
				replay: "safe",
				execute: async ({ text }) => {
					if (text.length > MAX_ALERT_CHARS) return { content: [{ type: "text", text: `Too long (${text.length} characters); keep it under ${MAX_ALERT_CHARS}.` }], isError: true };
					const refused = await send(text.trim());
					return refused ? { content: [{ type: "text", text: `Not sent: ${refused} Put it at the top of your report instead.` }], isError: true } : { content: [{ type: "text", text: "Alert sent to the operator." }] };
				},
			}),
		],
	});
