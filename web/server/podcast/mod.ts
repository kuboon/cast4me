/**
 * The podcast, assembled: its store, where its audio lives, and the daemon that fills it.
 */

import type { Config } from "../config.ts";
import { Daemon } from "./daemon.ts";
import { createScriptGenerator, type ScriptGenerator } from "./script/mod.ts";
import { Store } from "./store.ts";
import { createTts, type Tts } from "./tts/mod.ts";

export interface Podcast {
  config: Config;
  store: Store;
  audioDir: string;
  daemon: Daemon;
}

export interface OpenOptions {
  /** Deno KV path. Defaults to `<DATA_DIR>/cast4me.kv`; tests pass `":memory:"`. */
  kvPath?: string;
  script?: ScriptGenerator;
  tts?: Tts;
  fetch?: typeof fetch;
}

export async function openPodcast(
  config: Config,
  opts: OpenOptions = {},
): Promise<Podcast> {
  await Deno.mkdir(config.dataDir, { recursive: true });
  const audioDir = `${config.dataDir}/audio`;
  await Deno.mkdir(audioDir, { recursive: true });
  const store = await Store.open(opts.kvPath ?? `${config.dataDir}/cast4me.kv`);
  const daemon = new Daemon({
    store,
    audioDir,
    script: opts.script ?? createScriptGenerator(config),
    tts: opts.tts ?? createTts(config),
    config,
    fetch: opts.fetch,
  });
  return { config, store, audioDir, daemon };
}

export type { Episode, Item } from "./types.ts";
