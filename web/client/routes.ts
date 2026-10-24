/**
 * Every URL the app answers, in one place.
 *
 * `server/app.tsx` maps these to the actions that answer them, and everything that links reads
 * `routes.share.href()` rather than spelling `/share` at each call site. The client islands import
 * this file too, which is why it lives in `client/`.
 *
 * Access is split the way the daemon is exposed through Cloudflare Tunnel:
 *
 * - **Restricted**: `api.items` (ネタ投入) needs `Authorization: Bearer <INGEST_TOKEN>`.
 * - **Public**: everything else. Audio URLs carry an unguessable ULID rather than a secret.
 */

import { get, post, put, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  /** The player PWA. */
  home: get("/"),
  /** Manual ingest form, and the Web Share Target's landing page (`?title=&text=&url=`). */
  share: get("/share"),
  /** Podcast RSS with enclosures — the fallback for an ordinary podcast app. */
  feed: get("/feed.xml"),
  /** Audio by episode id, optionally with its extension (`<id>.mp3`) for podcast apps. */
  audio: get("/audio/:id(.:ext)"),
  manifest: get("/manifest.webmanifest"),
  api: route("api", {
    /** ネタ投入. Restricted (Bearer token). */
    items: post("/items"),
    /** Unplayed episodes, oldest first, for the player. */
    queue: get("/queue"),
    /** Playback finished (or skipped). Body: `{ "feedback"?: "like" | "skip" }`. */
    played: put("/episodes/:id/played"),
  }),
});
