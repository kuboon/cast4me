/**
 * Speech from any local command — `say` on macOS, Piper, VOICEVOX's CLI, a script of your own.
 *
 * `TTS_COMMAND` is split on whitespace (no shell), and `{in}` / `{out}` in it become the paths of
 * a text file holding the script and of the audio file the command must write. For example:
 *
 *     TTS_COMMAND="say -v Kyoko -f {in} -o {out} --data-format=aac"  TTS_COMMAND_EXT=m4a
 *
 * Anything needing pipes or redirects goes in a wrapper script, named here.
 */

import { type Audio, contentTypeFor, type Tts } from "./mod.ts";

export class CommandTts implements Tts {
  constructor(private readonly opts: { command: string; ext: string }) {
    if (!opts.command.trim()) {
      throw new Error("TTS_PROVIDER=command needs TTS_COMMAND");
    }
  }

  async synthesize(text: string): Promise<Audio> {
    const dir = await Deno.makeTempDir({ prefix: "cast4me-tts-" });
    try {
      const input = `${dir}/script.txt`;
      const output = `${dir}/audio.${this.opts.ext}`;
      await Deno.writeTextFile(input, text);
      const [cmd, ...args] = this.opts.command.trim().split(/\s+/).map((a) =>
        a.replaceAll("{in}", input).replaceAll("{out}", output)
      );
      const result = await new Deno.Command(cmd, {
        args,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) {
        throw new Error(
          `TTS command exited ${result.code}: ${
            new TextDecoder().decode(result.stderr).slice(0, 500)
          }`,
        );
      }
      return {
        data: await Deno.readFile(output),
        ext: this.opts.ext,
        contentType: contentTypeFor(this.opts.ext),
        durationSec: null,
      };
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
}
