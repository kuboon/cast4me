/**
 * The daemon's records: ネタ (items) waiting to be turned into episodes, and the episodes.
 */

import type { Feedback } from "../../client/lib/api.ts";

export type { Feedback };

export type ItemKind = "url" | "text" | "theme";
/** Where a ネタ came in from. */
export type ItemOrigin = "api" | "rss" | "fallback";
export type ItemStatus = "queued" | "processing" | "done" | "failed";

export interface Item {
  /** ULID — chronological, so listing by key is listing by age. */
  id: string;
  kind: ItemKind;
  origin: ItemOrigin;
  status: ItemStatus;
  /** For `url`. */
  url?: string;
  /** For `text` the body; for `url` an optional note; for `theme` the theme. */
  text?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  error?: string;
  episodeId?: string;
}

export interface Episode {
  /** ULID, also the public audio id. */
  id: string;
  itemId: string;
  title: string;
  description: string;
  script: string;
  /** File name under `<DATA_DIR>/audio/`. */
  audioFile: string;
  contentType: string;
  bytes: number;
  durationSec: number | null;
  sourceUrl: string | null;
  createdAt: string;
  playedAt?: string;
  feedback?: Feedback;
}

/** One piece of listener feedback, as the script generator is shown it. */
export interface FeedbackEntry {
  title: string;
  feedback: Feedback;
}
