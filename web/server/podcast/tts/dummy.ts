/**
 * A synthesizer that needs nothing: a quiet tone as long as the script would take to read, capped
 * so development episodes stay short. Lets the whole loop run with no API keys.
 */

import type { Audio, Tts } from "./mod.ts";

const SAMPLE_RATE = 8000;

export class DummyTts implements Tts {
  constructor(private readonly opts: { maxSeconds?: number } = {}) {}

  synthesize(text: string): Promise<Audio> {
    const seconds = Math.max(
      1,
      Math.min(this.opts.maxSeconds ?? 20, Math.round(text.length / 5)),
    );
    return Promise.resolve({
      data: toneWav(seconds),
      ext: "wav",
      contentType: "audio/wav",
      durationSec: seconds,
    });
  }
}

/** 8 kHz, 8-bit mono PCM WAV of a soft 440 Hz tone. */
export function toneWav(seconds: number): Uint8Array {
  const samples = SAMPLE_RATE * seconds;
  const buf = new Uint8Array(44 + samples);
  const view = new DataView(buf.buffer);
  const ascii = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    buf[44 + i] = 128 +
      Math.round(12 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
  }
  return buf;
}
