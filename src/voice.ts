// Voice notes: Telegram hands us an OGG/Opus file; Workers AI's Whisper turns it into text, which is then routed
// like a typed message. Claude models take no audio, so this happens before any agent sees the message.
import { bot, MAX_DOWNLOAD_BYTES } from "./telegram.ts";

export type VoiceFile = { file_id: string; duration: number; file_size?: number; mime_type?: string };

const MODEL = "@cf/openai/whisper-large-v3-turbo";
/** Longer notes are refused rather than transcribed: a five-minute monologue is better as text anyway. */
export const MAX_SECONDS = 300;

/** The note as text, or a thrown Error whose message is fit to show the operator. */
export async function transcribe(env: Env, voice: VoiceFile): Promise<string> {
	if (voice.duration > MAX_SECONDS) throw new Error(`That voice note is ${Math.round(voice.duration / 60)} minutes long; I transcribe up to ${MAX_SECONDS / 60}.`);
	if ((voice.file_size ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error("That voice note is too large for the Bot API to download (20 MB).");
	const audio = Buffer.from(await (await bot(env)).download(voice.file_id)).toString("base64");
	const out = (await env.AI.run(MODEL, { audio, vad_filter: true })) as { text?: string; transcription_info?: { text?: string } };
	const text = (out.transcription_info?.text ?? out.text ?? "").trim();
	if (!text) throw new Error("I couldn't make out any speech in that voice note.");
	return text;
}
