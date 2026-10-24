/**
 * Persistence for items and episodes, on Deno KV.
 *
 * Keys are `["item", id]` and `["episode", id]` with ULID ids, so a prefix listing comes back
 * oldest first. `["seen", url]` remembers every URL ever ingested, which is what keeps the RSS
 * poller from queueing the same article twice. Volumes here are one listener's worth — tens of
 * episodes a day — so listing a prefix and filtering is the whole query plan.
 */

import { monotonicUlid } from "@std/ulid";

import type {
  Episode,
  Feedback,
  FeedbackEntry,
  Item,
  ItemKind,
  ItemOrigin,
} from "./types.ts";

export interface NewItem {
  kind: ItemKind;
  origin: ItemOrigin;
  url?: string;
  text?: string;
  title?: string;
}

export class Store {
  constructor(private readonly kv: Deno.Kv) {}

  static async open(path?: string): Promise<Store> {
    return new Store(await Deno.openKv(path));
  }

  close(): void {
    this.kv.close();
  }

  newId(): string {
    return monotonicUlid();
  }

  // --- items ---------------------------------------------------------------

  /**
   * Queue a ネタ. A URL already seen is not queued again; `null` comes back instead.
   */
  async addItem(input: NewItem): Promise<Item | null> {
    const now = new Date().toISOString();
    const item: Item = {
      id: this.newId(),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      ...input,
    };
    const op = this.kv.atomic().set(["item", item.id], item);
    if (item.url) {
      const seenKey = ["seen", item.url];
      op.check({ key: seenKey, versionstamp: null }).set(seenKey, item.id);
    }
    const res = await op.commit();
    return res.ok ? item : null;
  }

  async getItem(id: string): Promise<Item | null> {
    return (await this.kv.get<Item>(["item", id])).value;
  }

  async putItem(item: Item): Promise<void> {
    await this.kv.set(["item", item.id], {
      ...item,
      updatedAt: new Date().toISOString(),
    });
  }

  async listItems(): Promise<Item[]> {
    const out: Item[] = [];
    for await (const e of this.kv.list<Item>({ prefix: ["item"] })) {
      out.push(e.value);
    }
    return out;
  }

  /** The oldest queued item. Items sent in by hand go before RSS and fallback ones. */
  async nextQueuedItem(): Promise<Item | null> {
    const queued = (await this.listItems()).filter((i) =>
      i.status === "queued"
    );
    const rank = (i: Item) =>
      i.origin === "api" ? 0 : i.origin === "rss" ? 1 : 2;
    queued.sort((a, b) => rank(a) - rank(b));
    return queued[0] ?? null;
  }

  async countQueued(): Promise<number> {
    return (await this.listItems()).filter((i) => i.status === "queued")
      .length;
  }

  /**
   * Put items stuck in `processing` back in the queue — a restart mid-generation leaves them so.
   */
  async requeueProcessing(): Promise<number> {
    let n = 0;
    for (const item of await this.listItems()) {
      if (item.status !== "processing") continue;
      await this.putItem({ ...item, status: "queued" });
      n++;
    }
    return n;
  }

  // --- episodes ------------------------------------------------------------

  async putEpisode(episode: Episode): Promise<void> {
    await this.kv.set(["episode", episode.id], episode);
  }

  async getEpisode(id: string): Promise<Episode | null> {
    return (await this.kv.get<Episode>(["episode", id])).value;
  }

  /** Every episode, oldest first, or newest first with `reverse`. */
  async listEpisodes(opts: { reverse?: boolean; limit?: number } = {}) {
    const out: Episode[] = [];
    for await (
      const e of this.kv.list<Episode>({ prefix: ["episode"] }, opts)
    ) {
      out.push(e.value);
    }
    return out;
  }

  /** Unplayed episodes, oldest first — the order they are played in. */
  async listUnplayed(): Promise<Episode[]> {
    return (await this.listEpisodes()).filter((e) => !e.playedAt);
  }

  /**
   * Record that an episode was played through or skipped. Idempotent: playing it again only
   * updates the feedback, and only when one is given.
   */
  async markPlayed(id: string, feedback?: Feedback): Promise<Episode | null> {
    const episode = await this.getEpisode(id);
    if (!episode) return null;
    const next: Episode = {
      ...episode,
      playedAt: episode.playedAt ?? new Date().toISOString(),
      ...(feedback ? { feedback } : {}),
    };
    await this.putEpisode(next);
    return next;
  }

  /** The latest feedback, newest first — what the script generator is told about. */
  async recentFeedback(limit = 20): Promise<FeedbackEntry[]> {
    const out: FeedbackEntry[] = [];
    for await (
      const e of this.kv.list<Episode>({ prefix: ["episode"] }, {
        reverse: true,
      })
    ) {
      if (e.value.feedback) {
        out.push({ title: e.value.title, feedback: e.value.feedback });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // --- small state ---------------------------------------------------------

  async getCounter(name: string): Promise<number> {
    return (await this.kv.get<number>(["counter", name])).value ?? 0;
  }

  async setCounter(name: string, value: number): Promise<void> {
    await this.kv.set(["counter", name], value);
  }
}
