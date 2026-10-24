/**
 * Speech synthesis — the swappable half that turns a script into audio.
 *
 * `createTts(config)` picks one by `TTS_PROVIDER`.
 */

import type { Config } from "../../config.ts";
import { CommandTts } from "./command.ts";
import { DummyTts } from "./dummy.ts";
import { OpenAiTts } from "./openai.ts";

export interface Audio {
  data: Uint8Array;
  /** File extension without the dot, e.g. `mp3`. */
  ext: string;
  contentType: string;
  /** Seconds, when the synthesizer knows. The player reads it off the file otherwise. */
  durationSec: number | null;
}

export interface Tts {
  synthesize(text: string): Promise<Audio>;
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  aiff: "audio/aiff",
  flac: "audio/flac",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

export function createTts(config: Config): Tts {
  const tts = config.tts;
  switch (tts.provider) {
    case "openai":
      return new OpenAiTts({
        apiKey: tts.openaiApiKey,
        model: tts.openaiModel,
        voice: tts.openaiVoice,
        instructions: tts.openaiInstructions,
      });
    case "command":
      return new CommandTts({ command: tts.command, ext: tts.commandExt });
    case "dummy":
      return new DummyTts();
  }
}

/**
 * Split a script into pieces no longer than `max` characters, at sentence ends where possible —
 * for synthesizers with an input limit.
 */
export function splitForTts(text: string, max: number): string[] {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]*/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && current.length + s.length > max) {
      out.push(current);
      current = "";
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    current += s;
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}
