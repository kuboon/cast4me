/**
 * cast4me service worker — downloads the next episodes ahead, and serves them from the cache.
 *
 * Served from `/sw.js` (a route of its own in `server/app.tsx`, not a file under `static/`) so its
 * scope is the whole site. The player posts `{ type: "precache", urls, keep }`: `urls` are the
 * next few episodes to have on the device, `keep` everything still in the queue. Anything cached
 * and no longer in `keep` was played, and is dropped.
 *
 * Media elements fetch with `Range`, and a cached response is the whole file, so ranges are cut
 * out of it here — iOS refuses to play audio answered with a plain `200` to a range request.
 */

const AUDIO_CACHE = "cast4me-audio-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("cast4me-") && name !== AUDIO_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== "precache") return;
  event.waitUntil(precache(data.urls ?? [], data.keep ?? []));
});

/** Paths with a download already under way, so repeated messages do not start a second. */
const inflight = new Set();

async function precache(urls, keep) {
  const cache = await caches.open(AUDIO_CACHE);
  const keepPaths = new Set(
    keep.map((u) => new URL(u, self.location).pathname),
  );
  for (const request of await cache.keys()) {
    if (!keepPaths.has(new URL(request.url).pathname)) {
      await cache.delete(request);
    }
  }
  for (const url of urls) {
    const path = new URL(url, self.location).pathname;
    if (inflight.has(path) || await cache.match(path)) continue;
    inflight.add(path);
    try {
      const res = await fetch(path);
      if (res.ok && res.status === 200) await cache.put(path, res);
    } catch {
      // Offline or the server is busy; the next message tries again.
    } finally {
      inflight.delete(path);
    }
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" || url.origin !== self.location.origin ||
    !url.pathname.startsWith("/audio/")
  ) {
    return;
  }
  event.respondWith(serveAudio(event.request, url.pathname));
});

async function serveAudio(request, path) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(path);
  if (!cached) return fetch(request);

  const range = request.headers.get("range");
  if (!range) return cached;

  const blob = await cached.blob();
  const size = blob.size;
  const m = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return cached;
  let start;
  let end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${size}` },
    });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": cached.headers.get("content-type") ?? blob.type,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
    },
  });
}
