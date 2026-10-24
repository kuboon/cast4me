/**
 * The JSON shapes the player and the daemon exchange — `GET /api/queue` and
 * `PUT /api/episodes/:id/played`. Shared so both sides agree by construction.
 */

/** What the listener said about an episode. Absent means "just finished it". */
export type Feedback = "like" | "skip";

export interface QueueEpisode {
  id: string;
  title: string;
  description: string;
  /** Path of the audio (`/audio/<id>.<ext>`), same-origin. */
  audioUrl: string;
  contentType: string;
  /** Seconds, when the synthesizer reported it. */
  durationSec: number | null;
  /** Where the ネタ came from, when it was a URL. */
  sourceUrl: string | null;
  createdAt: string;
}

export interface QueueResponse {
  episodes: QueueEpisode[];
  /** ネタ still waiting to be turned into episodes. */
  pendingItems: number;
  /** Whether the daemon is generating an episode right now. */
  generating: boolean;
}

export interface PlayedRequest {
  feedback?: Feedback;
}
