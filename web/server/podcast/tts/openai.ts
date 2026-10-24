/**
 * Speech with OpenAI's `/v1/audio/speech`. The script is sent in sentence-aligned pieces, since
 * the endpoint caps its input, and the MP3s that come back are concatenated — MP3 is a stream of
 * self-contained frames, so the joined file plays as one.
 */

import { type Audio, splitForTts, type Tts } from "./mod.ts";

/** Characters per request: comfortably under the endpoint's input limit for Japanese. */
const CHUNK_CHARS = 1000;

export class OpenAiTts implements Tts {
  constructor(
    private readonly opts: {
      apiKey: string;
      model: string;
      voice: string;
      instructions: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!opts.apiKey) {
      throw new Error("TTS_PROVIDER=openai needs OPENAI_API_KEY");
    }
  }

  async synthesize(text: string): Promise<Audio> {
    const fetchFn = this.opts.fetch ?? fetch;
    const parts: Uint8Array[] = [];
    for (const input of splitForTts(text, CHUNK_CHARS)) {
      const res = await fetchFn("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.opts.model,
          voice: this.opts.voice,
          input,
          instructions: this.opts.instructions,
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        throw new Error(
          `OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 300)}`,
        );
      }
      parts.push(new Uint8Array(await res.arrayBuffer()));
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      data.set(p, offset);
      offset += p.length;
    }
    return { data, ext: "mp3", contentType: "audio/mpeg", durationSec: null };
  }
}
