/**
 * The entry point for `deno serve`: open the podcast under `DATA_DIR`, start the daemon, and
 * serve the app. One process is the whole thing — API, PWA and the refill loop — meant to run on
 * a machine at home with Cloudflare Tunnel in front.
 */

import { createApp } from "./app.tsx";
import { getConfig } from "./config.ts";
import { openPodcast } from "./podcast/mod.ts";

const config = getConfig();
const podcast = await openPodcast(config);

if (!config.ingestToken) {
  console.warn(
    "[cast4me] INGEST_TOKEN is not set: POST /api/items refuses everything",
  );
}
console.log(
  `[cast4me] data=${config.dataDir} script=${config.script.provider} tts=${config.tts.provider} target=${config.targetUnplayed}`,
);
await podcast.daemon.start();

export default createApp(podcast);
