import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { createApp } from "./app.tsx";
import { loadConfig } from "./config.ts";
import { openPodcast } from "./podcast/mod.ts";
import { DummyScriptGenerator } from "./podcast/script/dummy.ts";
import type { ScriptInput } from "./podcast/script/mod.ts";
import { DummyTts } from "./podcast/tts/dummy.ts";
import type { QueueResponse } from "../client/lib/api.ts";

const TOKEN = "secret-token";

/** A fresh app over an in-memory store, with stand-ins for the network and the providers. */
async function setup(env: Record<string, string> = {}) {
  const dataDir = await Deno.makeTempDir({ prefix: "cast4me-test-" });
  const config = loadConfig({
    DATA_DIR: dataDir,
    INGEST_TOKEN: TOKEN,
    TARGET_UNPLAYED: "2",
    ...env,
  });
  const inputs: ScriptInput[] = [];
  const dummy = new DummyScriptGenerator();
  const pages: Record<string, string> = {
    "https://example.com/a":
      "<html><head><title>記事A</title></head><body><nav>menu</nav><article><p>本文A</p></article></body></html>",
    "https://example.com/feed.xml":
      `<rss><channel><item><title>B</title><link>https://example.com/b</link></item></channel></rss>`,
    "https://example.com/b": "<title>記事B</title><p>本文B</p>",
  };
  const podcast = await openPodcast(config, {
    kvPath: ":memory:",
    script: {
      generate: (input) => {
        inputs.push(input);
        return dummy.generate(input);
      },
    },
    tts: new DummyTts({ maxSeconds: 1 }),
    fetch: ((url: string | URL | Request) => {
      const body = pages[String(url)];
      return Promise.resolve(
        body === undefined
          ? new Response("nope", { status: 404 })
          : new Response(body, { headers: { "content-type": "text/html" } }),
      );
    }) as typeof fetch,
  });
  const app = createApp(podcast);
  const fetchApp = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`http://local${path}`, init));
  const cleanup = async () => {
    podcast.store.close();
    await Deno.remove(dataDir, { recursive: true });
  };
  return { podcast, fetchApp, inputs, cleanup };
}

const post = (body: unknown, token = TOKEN): RequestInit => ({
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

Deno.test("GET / renders the player island", async () => {
  const { fetchApp, cleanup } = await setup();
  const res = await fetchApp("/");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "cast4me");
  assertStringIncludes(html, "/assets/islands/player");
  assertStringIncludes(html, 'rel="manifest"');
  await cleanup();
});

Deno.test("GET /share renders the ingest form", async () => {
  const { fetchApp, cleanup } = await setup();
  const html = await (await fetchApp("/share?url=https://x")).text();
  assertStringIncludes(html, "/assets/islands/share_form");
  assertStringIncludes(html, "ネタ投入");
  await cleanup();
});

Deno.test("manifest declares the share target", async () => {
  const { fetchApp, cleanup } = await setup();
  const body = await (await fetchApp("/manifest.webmanifest")).json();
  assertEquals(body.share_target.action, "/share");
  assertEquals(body.share_target.method, "GET");
  await cleanup();
});

Deno.test("GET /sw.js serves the worker with a root scope", async () => {
  const { fetchApp, cleanup } = await setup();
  const res = await fetchApp("/sw.js");
  assertEquals(res.headers.get("service-worker-allowed"), "/");
  assertStringIncludes(await res.text(), "precache");
  await cleanup();
});

Deno.test("POST /api/items needs the bearer token", async () => {
  const { fetchApp, cleanup } = await setup();
  const none = await fetchApp("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x" }),
  });
  assertEquals(none.status, 401);
  await none.body?.cancel();
  const wrong = await fetchApp("/api/items", post({ text: "x" }, "nope"));
  assertEquals(wrong.status, 401);
  await wrong.body?.cancel();
  await cleanup();
});

Deno.test("POST /api/items is refused when no token is configured", async () => {
  const { fetchApp, cleanup } = await setup({ INGEST_TOKEN: "" });
  const res = await fetchApp("/api/items", post({ text: "x" }));
  assertEquals(res.status, 503);
  await res.body?.cancel();
  await cleanup();
});

Deno.test("ingest → refill → queue → audio → played, end to end", async () => {
  const { podcast, fetchApp, inputs, cleanup } = await setup();

  const created = await fetchApp(
    "/api/items",
    post({ url: "https://example.com/a" }),
  );
  assertEquals(created.status, 201);
  await created.body?.cancel();
  // The same URL twice is not queued twice.
  const dup = await fetchApp(
    "/api/items",
    post({ text: "見て https://example.com/a" }),
  );
  assertEquals((await dup.json()).duplicate, true);
  const text = await fetchApp("/api/items", post({ text: "メモのネタ" }));
  assertEquals(text.status, 201);
  await text.body?.cancel();

  await podcast.daemon.refill();

  const queue = await (await fetchApp("/api/queue")).json() as QueueResponse;
  assertEquals(queue.episodes.length, 2);
  assertEquals(queue.episodes[0].title, "記事A");
  assertEquals(queue.episodes[0].sourceUrl, "https://example.com/a");
  assertStringIncludes(inputs[0].source.text, "本文A");
  assert(!inputs[0].source.text.includes("menu"), "page chrome is dropped");

  // Audio, whole and by range.
  const path = queue.episodes[0].audioUrl;
  assert(path.endsWith(".wav"));
  const whole = await fetchApp(path);
  assertEquals(whole.status, 200);
  assertEquals(whole.headers.get("accept-ranges"), "bytes");
  const size = (await whole.arrayBuffer()).byteLength;
  const part = await fetchApp(path, { headers: { range: "bytes=0-43" } });
  assertEquals(part.status, 206);
  assertEquals(part.headers.get("content-range"), `bytes 0-43/${size}`);
  assertEquals(
    new TextDecoder().decode((await part.arrayBuffer()).slice(0, 4)),
    "RIFF",
  );
  const bad = await fetchApp(path, { headers: { range: `bytes=${size}-` } });
  assertEquals(bad.status, 416);
  await bad.body?.cancel();
  const missing = await fetchApp("/audio/nothing");
  assertEquals(missing.status, 404);
  await missing.body?.cancel();

  // The feed lists both, with absolute enclosure URLs.
  const feed = await (await fetchApp("/feed.xml", {
    headers: { host: "cast.example", "x-forwarded-proto": "https" },
  })).text();
  assertStringIncludes(feed, `url="https://cast.example${path}"`);
  assertStringIncludes(feed, "<title>記事A</title>");

  // Skip the first; feedback reaches the next script.
  const played = await fetchApp(
    `/api/episodes/${queue.episodes[0].id}/played`,
    { method: "PUT", body: JSON.stringify({ feedback: "skip" }) },
  );
  assertEquals(played.status, 200);
  await played.body?.cancel();
  const after = await (await fetchApp("/api/queue")).json() as QueueResponse;
  assertEquals(after.episodes.map((e) => e.id), [queue.episodes[1].id]);

  await fetchApp("/api/items", post({ theme: "量子コンピュータ" })).then((r) =>
    r.body?.cancel()
  );
  await podcast.daemon.refill();
  const last = inputs.at(-1)!;
  assertEquals(last.source.kind, "theme");
  assertEquals(last.feedback, [{ title: "記事A", feedback: "skip" }]);

  const unknown = await fetchApp("/api/episodes/nope/played", {
    method: "PUT",
  });
  assertEquals(unknown.status, 404);
  await unknown.body?.cancel();
  const invalid = await fetchApp(
    `/api/episodes/${queue.episodes[1].id}/played`,
    { method: "PUT", body: JSON.stringify({ feedback: "meh" }) },
  );
  assertEquals(invalid.status, 400);
  await invalid.body?.cancel();

  await cleanup();
});

Deno.test("share target form posts are read like the share sheet sends them", async () => {
  const { podcast, fetchApp, cleanup } = await setup();
  const form = new URLSearchParams({
    title: "共有タイトル",
    text: "これ https://example.com/a",
  });
  const res = await fetchApp("/api/items", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  assertEquals(res.status, 201);
  const { id } = await res.json();
  const item = await podcast.store.getItem(id);
  assertEquals(item?.kind, "url");
  assertEquals(item?.url, "https://example.com/a");
  assertEquals(item?.text, "これ");
  assertEquals(item?.title, "共有タイトル");
  await cleanup();
});

Deno.test("RSS polling queues new entries once, and fallback themes fill an empty queue", async () => {
  const { podcast, cleanup } = await setup({
    RSS_FEEDS: "https://example.com/feed.xml",
    FALLBACK_THEMES: "テーマ1,テーマ2",
    TARGET_UNPLAYED: "3",
  });
  assertEquals(await podcast.daemon.pollFeeds(), 1);
  assertEquals(await podcast.daemon.pollFeeds(), 0);
  await podcast.daemon.refill();
  const episodes = await podcast.store.listUnplayed();
  assertEquals(episodes.map((e) => e.title), ["B", "テーマ1", "テーマ2"]);
  await cleanup();
});

Deno.test("a failing ネタ is retried, then marked failed", async () => {
  const { podcast, cleanup } = await setup();
  const item = await podcast.store.addItem({
    kind: "url",
    origin: "api",
    url: "https://example.com/404",
  });
  for (let i = 0; i < 3; i++) await podcast.daemon.refill();
  const after = await podcast.store.getItem(item!.id);
  assertEquals(after?.status, "failed");
  assertEquals(after?.attempts, 3);
  assertStringIncludes(after?.error ?? "", "404");
  await cleanup();
});
