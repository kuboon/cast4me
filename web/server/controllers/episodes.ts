/**
 * The public, read-mostly side: the player's queue, the played notice, the podcast feed, and the
 * audio itself.
 */

import type {
  Feedback,
  PlayedRequest,
  QueueEpisode,
  QueueResponse,
} from "../../client/lib/api.ts";
import type { Episode, Podcast } from "../podcast/mod.ts";
import { audioPath, renderPodcastFeed } from "../podcast/rss.ts";

type Ctx = { request: Request; params: { id?: string } };

export const SITE_TITLE = "cast4me";

function toQueueEpisode(e: Episode): QueueEpisode {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    audioUrl: audioPath(e),
    contentType: e.contentType,
    durationSec: e.durationSec,
    sourceUrl: e.sourceUrl,
    createdAt: e.createdAt,
  };
}

export function queueAction(podcast: Podcast) {
  return async (): Promise<Response> => {
    const body: QueueResponse = {
      episodes: (await podcast.store.listUnplayed()).map(toQueueEpisode),
      pendingItems: await podcast.store.countQueued(),
      generating: podcast.daemon.generating,
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  };
}

const FEEDBACK: readonly Feedback[] = ["like", "skip"];

export function playedAction(podcast: Podcast) {
  return async ({ request, params }: Ctx): Promise<Response> => {
    let body: PlayedRequest = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ message: "Invalid JSON" }, { status: 400 });
      }
    }
    if (body.feedback !== undefined && !FEEDBACK.includes(body.feedback)) {
      return Response.json({ message: "feedback must be like or skip" }, {
        status: 400,
      });
    }
    const episode = await podcast.store.markPlayed(
      params.id ?? "",
      body.feedback,
    );
    if (!episode) {
      return Response.json({ message: "Not found" }, { status: 404 });
    }
    void podcast.daemon.refill().catch((e) => console.error(e));
    return Response.json({
      id: episode.id,
      feedback: episode.feedback ?? null,
    });
  };
}

/**
 * The origin the outside world sees. `PUBLIC_ORIGIN` when set; otherwise what Cloudflare Tunnel
 * forwards (`Host` and `X-Forwarded-Proto`), falling back to the request URL.
 */
export function publicOrigin(request: Request, configured: string): string {
  if (configured) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ?? url.host;
  return `${proto || url.protocol.replace(":", "")}://${host}`;
}

export function feedAction(podcast: Podcast) {
  return async ({ request }: Ctx): Promise<Response> => {
    const episodes = await podcast.store.listEpisodes({
      reverse: true,
      limit: 100,
    });
    const xml = renderPodcastFeed({
      origin: publicOrigin(request, podcast.config.publicOrigin),
      title: SITE_TITLE,
      description: "自分専用のエンドレスポッドキャスト",
      episodes,
    });
    return new Response(xml, {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  };
}

/** ULIDs: 26 Crockford base32 characters. Anything else is not an episode. */
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * `GET /audio/:id(.:ext)`, with `Range` support — iOS will not play audio from a server that ignores
 * it. Immutable once written, so it is cached for good.
 */
export function audioAction(podcast: Podcast) {
  return async ({ request, params }: Ctx): Promise<Response> => {
    const id = (params.id ?? "").toUpperCase();
    const episode = ID_RE.test(id) ? await podcast.store.getEpisode(id) : null;
    if (!episode) return new Response("Not Found", { status: 404 });

    let file: Deno.FsFile;
    try {
      file = await Deno.open(`${podcast.audioDir}/${episode.audioFile}`);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    const size = (await file.stat()).size;
    const headers = new Headers({
      "content-type": episode.contentType,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
    });

    const range = parseRange(request.headers.get("range"), size);
    if (range === "invalid") {
      file.close();
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (request.method === "HEAD") {
      file.close();
      headers.set("content-length", String(size));
      return new Response(null, { status: 200, headers });
    }
    if (!range) {
      headers.set("content-length", String(size));
      return new Response(file.readable, { status: 200, headers });
    }

    const [start, end] = range;
    await file.seek(start, Deno.SeekMode.Start);
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(limit(file, end - start + 1), { status: 206, headers });
  };
}

/** One byte range, inclusive; `null` for no (or an unsupported multi-) range. */
export function parseRange(
  header: string | null,
  size: number,
): [number, number] | null | "invalid" {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === "") {
    if (b === "") return "invalid";
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return [start, end];
}

/** The next `length` bytes of `file` as a stream, closing the file when done. */
function limit(file: Deno.FsFile, length: number): ReadableStream<Uint8Array> {
  let remaining = length;
  return new ReadableStream({
    async pull(controller) {
      const buf = new Uint8Array(Math.min(64 * 1024, remaining));
      const n = await file.read(buf);
      if (n === null || n === 0) {
        file.close();
        controller.close();
        return;
      }
      controller.enqueue(buf.subarray(0, n));
      remaining -= n;
      if (remaining <= 0) {
        file.close();
        controller.close();
      }
    },
    cancel() {
      file.close();
    },
  });
}
