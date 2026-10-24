/**
 * The daemon: keeps N unplayed episodes ready, and pulls ネタ from RSS.
 *
 * {@link Daemon.refill} is the one entry point for "make episodes if there are too few". It is
 * single-flight — a call while a round is running asks that round to go once more rather than
 * starting a second one — so the timer, a new ネタ and a finished episode can all call it freely.
 */

import type { Config } from "../config.ts";
import type { ScriptGenerator } from "./script/mod.ts";
import { type Fetch, resolveSource } from "./sources.ts";
import { parseFeed } from "./rss.ts";
import type { Store } from "./store.ts";
import type { Tts } from "./tts/mod.ts";
import type { Episode, Item } from "./types.ts";

/** Attempts per ネタ before it is marked `failed`. */
const MAX_ATTEMPTS = 3;
/** Newest entries taken from each feed per poll. Older ones are left alone. */
const ENTRIES_PER_FEED = 5;

export type DaemonConfig = Pick<
  Config,
  | "targetUnplayed"
  | "episodeMinutes"
  | "refillIntervalSec"
  | "rssFeeds"
  | "rssIntervalMin"
  | "fallbackThemes"
>;

export interface DaemonDeps {
  store: Store;
  /** Directory the audio files are written to. */
  audioDir: string;
  script: ScriptGenerator;
  tts: Tts;
  config: DaemonConfig;
  fetch?: Fetch;
}

export class Daemon {
  readonly #deps: DaemonDeps;
  #round: Promise<void> | null = null;
  #again = false;

  constructor(deps: DaemonDeps) {
    this.#deps = deps;
  }

  /** Whether a refill round is running. */
  get generating(): boolean {
    return this.#round !== null;
  }

  /** Generate episodes until enough are unplayed, or the ネタ run out. */
  refill(): Promise<void> {
    if (this.#round) {
      this.#again = true;
      return this.#round;
    }
    this.#round = (async () => {
      try {
        do {
          this.#again = false;
          while (await this.#needsMore()) {
            if (!await this.#produceOne()) break;
          }
        } while (this.#again);
      } finally {
        this.#round = null;
      }
    })();
    return this.#round;
  }

  async #needsMore(): Promise<boolean> {
    const unplayed = await this.#deps.store.listUnplayed();
    return unplayed.length < this.#deps.config.targetUnplayed;
  }

  /** Make one episode. `false` when there was nothing to make it from, or making it failed. */
  async #produceOne(): Promise<boolean> {
    const { store } = this.#deps;
    const item = (await store.nextQueuedItem()) ?? (await this.#fallbackItem());
    if (!item) return false;

    const working: Item = {
      ...item,
      status: "processing",
      attempts: item.attempts + 1,
    };
    await store.putItem(working);
    try {
      const episode = await this.#makeEpisode(working);
      await store.putItem({
        ...working,
        status: "done",
        episodeId: episode.id,
        error: undefined,
      });
      console.log(`[daemon] episode ${episode.id}: ${episode.title}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = working.attempts >= MAX_ATTEMPTS;
      await store.putItem({
        ...working,
        status: failed ? "failed" : "queued",
        error: message,
      });
      console.error(
        `[daemon] item ${item.id} ${
          failed ? "failed" : "will retry"
        }: ${message}`,
      );
      // Stop this round: the next timer tick retries, which is the backoff.
      return false;
    }
  }

  /** A theme ネタ from `FALLBACK_THEMES`, in rotation, for when the queue is empty. */
  async #fallbackItem(): Promise<Item | null> {
    const { store, config } = this.#deps;
    if (config.fallbackThemes.length === 0) return null;
    const n = await store.getCounter("fallback");
    await store.setCounter("fallback", n + 1);
    const theme = config.fallbackThemes[n % config.fallbackThemes.length];
    return await store.addItem({
      kind: "theme",
      origin: "fallback",
      text: theme,
    });
  }

  async #makeEpisode(item: Item): Promise<Episode> {
    const { store, config, audioDir } = this.#deps;
    const source = await resolveSource(item, this.#deps.fetch);
    const [feedback, recent] = await Promise.all([
      store.recentFeedback(20),
      store.listEpisodes({ reverse: true, limit: 10 }),
    ]);
    const script = await this.#deps.script.generate({
      source,
      feedback,
      recentTitles: recent.map((e) => e.title),
      targetMinutes: config.episodeMinutes,
    });
    const audio = await this.#deps.tts.synthesize(script.script);

    const id = store.newId();
    const audioFile = `${id}.${audio.ext}`;
    await Deno.mkdir(audioDir, { recursive: true });
    await Deno.writeFile(`${audioDir}/${audioFile}`, audio.data);

    const episode: Episode = {
      id,
      itemId: item.id,
      title: script.title,
      description: script.description,
      script: script.script,
      audioFile,
      contentType: audio.contentType,
      bytes: audio.data.length,
      durationSec: audio.durationSec,
      sourceUrl: item.url ?? null,
      createdAt: new Date().toISOString(),
    };
    await store.putEpisode(episode);
    return episode;
  }

  /** Queue the newest entries of every `RSS_FEEDS` feed. Already-seen URLs are skipped. */
  async pollFeeds(): Promise<number> {
    const fetchFn = this.#deps.fetch ?? fetch;
    let added = 0;
    for (const feed of this.#deps.config.rssFeeds) {
      try {
        const res = await fetchFn(feed, {
          headers: { "user-agent": "cast4me/1.0" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const entries = parseFeed(await res.text()).slice(0, ENTRIES_PER_FEED);
        // Oldest first, so ULIDs — and so the queue — keep the feed's order.
        for (const entry of entries.reverse()) {
          const item = await this.#deps.store.addItem({
            kind: "url",
            origin: "rss",
            url: entry.url,
            title: entry.title,
          });
          if (item) added++;
        }
      } catch (error) {
        console.error(
          `[rss] ${feed}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (added) console.log(`[rss] queued ${added} item(s)`);
    return added;
  }

  /**
   * Run until `signal` aborts: recover from a crash mid-generation, then refill and poll on their
   * timers.
   */
  async start(signal?: AbortSignal): Promise<void> {
    const { store, config } = this.#deps;
    const requeued = await store.requeueProcessing();
    if (requeued) {
      console.log(`[daemon] requeued ${requeued} interrupted item(s)`);
    }

    const tick = () => void this.refill().catch((e) => console.error(e));
    const poll = () =>
      void this.pollFeeds().then((n) => n && tick()).catch((e) =>
        console.error(e)
      );

    const timers = [setInterval(tick, config.refillIntervalSec * 1000)];
    if (config.rssFeeds.length) {
      timers.push(setInterval(poll, config.rssIntervalMin * 60_000));
      poll();
    }
    signal?.addEventListener("abort", () => timers.forEach(clearInterval));
    tick();
  }
}
